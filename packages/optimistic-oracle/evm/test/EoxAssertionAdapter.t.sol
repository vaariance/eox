// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {EoxAssertionAdapter} from "../src/EoxAssertionAdapter.sol";
import {IOptimisticOracleV3} from "../src/interfaces/IOptimisticOracleV3.sol";
import {IWormhole} from "../src/interfaces/IWormhole.sol";
import {MockOptimisticOracleV3} from "./mocks/MockOptimisticOracleV3.sol";
import {MockWormhole} from "./mocks/MockWormhole.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract EoxAssertionAdapterTest is Test {
    uint16 constant YEAR = 2025;
    uint256 constant CUTOFF_2025 = 1_785_456_000; // 2026-07-31T00:00:00Z
    uint256 constant MIN_BOND = 500e6;
    uint256 constant BOND = 1_000e6;
    bytes32 constant IMAGE_ID = bytes32(uint256(0x2222));
    string constant URI = "ipfs://eox-2025-snapshot";

    MockOptimisticOracleV3 oracle;
    MockWormhole wormhole;
    MockERC20 usdc;
    EoxAssertionAdapter adapter;

    address owner = makeAddr("owner");
    address asserter = makeAddr("asserter");
    address stranger = makeAddr("stranger");
    // Hashed once here: calling the SHA-256 precompile is an external call, which would use up
    // a pending vm.prank or vm.expectRevert.
    bytes32 uriHash;

    function setUp() public {
        uriHash = sha256(bytes(URI));
        oracle = new MockOptimisticOracleV3(MIN_BOND);
        wormhole = new MockWormhole();
        usdc = new MockERC20();
        adapter = new EoxAssertionAdapter(
            IOptimisticOracleV3(address(oracle)), IWormhole(address(wormhole)), IERC20(address(usdc)), owner
        );

        usdc.mint(asserter, 10 * BOND);
        vm.prank(asserter);
        usdc.approve(address(adapter), type(uint256).max);
    }

    function claim() internal view returns (EoxAssertionAdapter.Claim memory) {
        return EoxAssertionAdapter.Claim({
            evidenceRoot: bytes32(uint256(0x1111)),
            methodologyImageId: IMAGE_ID,
            outputHash: bytes32(uint256(0x3333)),
            resolutionUriHash: uriHash
        });
    }

    function openEpoch() internal {
        vm.prank(owner);
        adapter.openEpoch(YEAR, IMAGE_ID, BOND);
    }

    function assertAt(uint256 timestamp) internal returns (bytes32) {
        vm.warp(timestamp);
        vm.prank(asserter);
        return adapter.assertResult(YEAR, claim(), URI);
    }

    function settled() internal returns (bytes32 id) {
        openEpoch();
        id = assertAt(CUTOFF_2025);
        oracle.resolve(id, true);
    }

    function test_cutoff_matches_the_solana_program() public view {
        assertEq(adapter.cutoffTimestamp(2025), CUTOFF_2025);
        assertEq(adapter.cutoffTimestamp(1969), 18_230_400);
        assertEq(adapter.cutoffTimestamp(2027) - adapter.cutoffTimestamp(2026), 366 days);
    }

    function testFuzz_consecutive_cutoffs_are_a_year_apart(uint16 year) public view {
        vm.assume(year >= 1970 && year < type(uint16).max);
        uint256 gap = adapter.cutoffTimestamp(year + 1) - adapter.cutoffTimestamp(year);
        assertTrue(gap == 365 days || gap == 366 days);
        assertEq(adapter.cutoffTimestamp(year) % 1 days, 0);
    }

    function test_only_the_owner_opens_an_epoch() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        adapter.openEpoch(YEAR, IMAGE_ID, BOND);
    }

    function test_an_epoch_opens_once() public {
        openEpoch();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(EoxAssertionAdapter.EpochAlreadyOpen.selector, YEAR));
        adapter.openEpoch(YEAR, IMAGE_ID, BOND);
    }

    function test_the_bond_must_meet_the_oracle_minimum() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(EoxAssertionAdapter.BondBelowMinimum.selector, MIN_BOND - 1, MIN_BOND));
        adapter.openEpoch(YEAR, IMAGE_ID, MIN_BOND - 1);
    }

    function test_an_assertion_goes_to_uma_with_the_bond_and_settings() public {
        openEpoch();
        bytes32 id = assertAt(CUTOFF_2025);

        (
            ,
            address recordedAsserter,
            address callbackRecipient,
            address escalationManager,
            uint64 liveness,
            IERC20 currency,
            uint256 bond,
            bytes32 identifier,
            bytes32 domainId
        ) = oracle.assertions(id);
        assertEq(recordedAsserter, asserter);
        assertEq(callbackRecipient, address(adapter));
        assertEq(escalationManager, address(0));
        assertEq(liveness, 72 hours);
        assertEq(address(currency), address(usdc));
        assertEq(bond, BOND);
        assertEq(identifier, oracle.DEFAULT_IDENTIFIER());
        assertEq(domainId, bytes32(0));

        assertEq(usdc.balanceOf(address(oracle)), BOND);
        assertEq(usdc.balanceOf(address(adapter)), 0);
        assertEq(usdc.balanceOf(asserter), 9 * BOND);
        assertEq(adapter.epochs(YEAR).activeAssertion, id);
    }

    function test_the_claim_text_tells_voters_what_makes_it_true() public {
        openEpoch();
        bytes32 id = assertAt(CUTOFF_2025);
        assertEq(
            string(oracle.claimOf(id)),
            string.concat(
                "EOX yearly result for epoch 2025. Evidence root: ",
                "0x0000000000000000000000000000000000000000000000000000000000001111",
                ". Methodology image ID: ",
                "0x0000000000000000000000000000000000000000000000000000000000002222",
                ". Output hash: ",
                "0x0000000000000000000000000000000000000000000000000000000000003333",
                ". Snapshot and output bundle: ipfs://eox-2025-snapshot",
                ". This assertion is true if and only if the evidence root is the Merkle root, as the methodology with that image ID defines it,",
                " of the official observations for 2025 known at the evidence cutoff (31 July 2026, 00:00 UTC),",
                " and running the methodology with that image ID over that snapshot produces exactly that output hash."
            )
        );
    }

    function test_assertions_open_at_the_cutoff_and_close_after_the_window() public {
        openEpoch();
        uint256 closesAt = CUTOFF_2025 + adapter.ASSERTION_WINDOW();

        vm.warp(CUTOFF_2025 - 1);
        vm.prank(asserter);
        vm.expectRevert(abi.encodeWithSelector(EoxAssertionAdapter.TooEarly.selector, CUTOFF_2025));
        adapter.assertResult(YEAR, claim(), URI);

        vm.warp(closesAt + 1);
        vm.prank(asserter);
        vm.expectRevert(abi.encodeWithSelector(EoxAssertionAdapter.AssertionWindowClosed.selector, closesAt));
        adapter.assertResult(YEAR, claim(), URI);

        assertAt(closesAt);
    }

    function test_an_assertion_needs_an_open_epoch() public {
        vm.warp(CUTOFF_2025);
        vm.prank(asserter);
        vm.expectRevert(abi.encodeWithSelector(EoxAssertionAdapter.EpochNotOpen.selector, YEAR));
        adapter.assertResult(YEAR, claim(), URI);
    }

    function test_an_assertion_must_use_the_epoch_methodology() public {
        openEpoch();
        EoxAssertionAdapter.Claim memory wrong = claim();
        wrong.methodologyImageId = bytes32(uint256(0x9999));
        vm.warp(CUTOFF_2025);
        vm.prank(asserter);
        vm.expectRevert(
            abi.encodeWithSelector(EoxAssertionAdapter.WrongMethodology.selector, IMAGE_ID, wrong.methodologyImageId)
        );
        adapter.assertResult(YEAR, wrong, URI);
    }

    function test_the_uri_must_hash_to_the_claimed_uri_hash() public {
        openEpoch();
        vm.warp(CUTOFF_2025);
        vm.prank(asserter);
        vm.expectRevert(EoxAssertionAdapter.ResolutionUriMismatch.selector);
        adapter.assertResult(YEAR, claim(), "ipfs://somewhere-else");
    }

    function test_one_assertion_at_a_time() public {
        openEpoch();
        bytes32 id = assertAt(CUTOFF_2025);
        vm.prank(asserter);
        vm.expectRevert(abi.encodeWithSelector(EoxAssertionAdapter.AssertionPending.selector, id));
        adapter.assertResult(YEAR, claim(), URI);
    }

    function test_a_true_assertion_settles_the_epoch() public {
        bytes32 id = settled();
        EoxAssertionAdapter.Epoch memory epoch = adapter.epochs(YEAR);
        assertTrue(epoch.settled);
        assertEq(epoch.activeAssertion, bytes32(0));
        assertEq(epoch.resultAssertion, id);
        assertEq(epoch.result.outputHash, claim().outputHash);

        vm.prank(asserter);
        vm.expectRevert(abi.encodeWithSelector(EoxAssertionAdapter.EpochAlreadySettled.selector, YEAR));
        adapter.assertResult(YEAR, claim(), URI);
    }

    function test_a_false_assertion_lets_a_new_one_in() public {
        openEpoch();
        bytes32 first = assertAt(CUTOFF_2025);
        oracle.dispute(first);
        assertEq(adapter.epochs(YEAR).activeAssertion, first, "a disputed assertion stays pending until the vote");

        oracle.resolve(first, false);
        assertFalse(adapter.epochs(YEAR).settled);
        assertEq(adapter.epochs(YEAR).activeAssertion, bytes32(0));

        bytes32 second = assertAt(CUTOFF_2025 + 5 days);
        oracle.resolve(second, true);
        assertEq(adapter.epochs(YEAR).resultAssertion, second);
    }

    function test_only_the_oracle_calls_back() public {
        openEpoch();
        bytes32 id = assertAt(CUTOFF_2025);

        vm.prank(stranger);
        vm.expectRevert(EoxAssertionAdapter.NotOracle.selector);
        adapter.assertionResolvedCallback(id, true);

        vm.prank(stranger);
        vm.expectRevert(EoxAssertionAdapter.NotOracle.selector);
        adapter.assertionDisputedCallback(id);
    }

    function test_callbacks_for_unknown_assertions_are_rejected() public {
        openEpoch();
        assertAt(CUTOFF_2025);
        bytes32 bogus = keccak256("not ours");
        vm.prank(address(oracle));
        vm.expectRevert(abi.encodeWithSelector(EoxAssertionAdapter.UnknownAssertion.selector, bogus));
        adapter.assertionResolvedCallback(bogus, true);
    }

    function test_the_payload_layout_is_what_the_solana_program_reads() public {
        bytes32 id = settled();
        bytes memory payload = adapter.resultPayload(YEAR);
        EoxAssertionAdapter.Claim memory c = claim();

        assertEq(payload.length, 167);
        assertEq(
            payload,
            bytes.concat(
                adapter.PAYLOAD_MAGIC(),
                bytes1(0x01),
                bytes2(uint16(2025)),
                c.evidenceRoot,
                c.methodologyImageId,
                c.outputHash,
                c.resolutionUriHash,
                id
            )
        );
        assertEq(uint8(payload[5]), 0x07, "year is big-endian: 2025 = 0x07e9");
        assertEq(uint8(payload[6]), 0xe9);
    }

    /// The same bytes are parsed by the Solana program's tests (`GOLDEN_PAYLOAD`), so a change
    /// to the layout on either side fails a test.
    function test_golden_payload() public {
        settled();
        assertEq(
            adapter.resultPayload(YEAR),
            hex"454f58520107e9"
            hex"0000000000000000000000000000000000000000000000000000000000001111"
            hex"0000000000000000000000000000000000000000000000000000000000002222"
            hex"0000000000000000000000000000000000000000000000000000000000003333"
            hex"3bd078a333c9589d2d52ae40c744d98d26f14af482521bab3fff59c26fa8d4ad"
            hex"b10e2d527612073b26eecdfd717e6a320cf44b4afac2b0732d9fcbe2b7fa0cf6"
        );
    }

    function test_publishing_needs_a_settled_epoch() public {
        openEpoch();
        vm.expectRevert(abi.encodeWithSelector(EoxAssertionAdapter.EpochNotSettled.selector, YEAR));
        adapter.publishResult(YEAR);
    }

    function test_publishing_sends_the_result_to_wormhole_and_can_be_repeated() public {
        settled();
        wormhole.setFee(0.001 ether);
        vm.deal(stranger, 1 ether);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(EoxAssertionAdapter.WrongFee.selector, 0.001 ether, 0));
        adapter.publishResult(YEAR);

        vm.prank(stranger);
        assertEq(adapter.publishResult{value: 0.001 ether}(YEAR), 0);
        vm.prank(stranger);
        assertEq(adapter.publishResult{value: 0.001 ether}(YEAR), 1);

        (address emitter, uint32 nonce, bytes memory payload, uint8 consistency, uint256 fee) = wormhole.published(0);
        assertEq(emitter, address(adapter));
        assertEq(nonce, 0);
        assertEq(payload, adapter.resultPayload(YEAR));
        assertEq(consistency, 1);
        assertEq(fee, 0.001 ether);
        assertEq(wormhole.count(), 2);
    }
}
