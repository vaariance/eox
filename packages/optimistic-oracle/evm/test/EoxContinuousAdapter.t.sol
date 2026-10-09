// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, Vm} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ContinuousProtocol as P} from "../src/ContinuousProtocol.sol";
import {EoxContinuousAdapter} from "../src/EoxContinuousAdapter.sol";
import {IOptimisticOracleV3} from "../src/interfaces/IOptimisticOracleV3.sol";
import {IWormhole} from "../src/interfaces/IWormhole.sol";
import {MockOptimisticOracleV3} from "./mocks/MockOptimisticOracleV3.sol";
import {MockWormhole} from "./mocks/MockWormhole.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {ClaimEncoder} from "./utils/ClaimEncoder.sol";

contract EoxContinuousAdapterTest is Test {
    uint256 constant MIN_BOND = 2_000e6;
    uint64 constant EPOCH = 7;
    uint16 constant WORMHOLE_CHAIN = 10_002;
    uint64 constant START = 1_800_000_000;
    bytes32 constant PROGRAM = bytes32(uint256(0xA1));
    bytes32 constant REGISTRY = bytes32(uint256(0xA2));
    bytes32 constant MANIFEST = bytes32(uint256(0xB1));
    bytes32 constant CONFIG = bytes32(uint256(0xB2));
    bytes32 constant POLICY = bytes32(uint256(0xB3));
    bytes32 constant PROPOSAL = bytes32(uint256(0xC1));
    bytes32 constant PRECOMMIT = bytes32(uint256(0xC2));
    bytes32 constant PROPOSAL_2 = bytes32(uint256(0xD1));
    bytes32 constant PRECOMMIT_2 = bytes32(uint256(0xD2));
    string constant CURRENT = "eox:observation:123";
    string constant COMPARISON = "eox:observation:98";

    MockOptimisticOracleV3 oracle;
    MockWormhole wormhole;
    MockERC20 token;
    EoxContinuousAdapter adapter;

    address owner = makeAddr("owner");
    address asserter = makeAddr("asserter");
    address challenger = makeAddr("challenger");
    address stranger = makeAddr("stranger");

    struct Registered {
        bytes32 current;
        bytes32 comparison;
        bytes32 snapshot;
        bytes32[] evidence;
    }

    function setUp() public {
        vm.warp(START);
        oracle = new MockOptimisticOracleV3(MIN_BOND);
        wormhole = new MockWormhole();
        token = new MockERC20();
        adapter = new EoxContinuousAdapter(
            IOptimisticOracleV3(address(oracle)),
            IWormhole(address(wormhole)),
            IERC20(address(token)),
            PROGRAM,
            REGISTRY,
            owner
        );

        vm.startPrank(owner);
        adapter.openEpoch(EPOCH, MANIFEST, CONFIG, POLICY);
        adapter.setAsserter(asserter, true);
        vm.stopPrank();

        token.mint(asserter, 100 * MIN_BOND);
        vm.prank(asserter);
        token.approve(address(adapter), type(uint256).max);
    }

    function test_evidence_goes_to_uma_with_one_hour_liveness_and_the_minimum_bond() public {
        bytes memory claim = _evidence(CURRENT, 7);
        bytes32 digest = P.digest(P.EVIDENCE_DOMAIN, claim);
        vm.prank(asserter);
        bytes32 id = adapter.assertEvidence(PROPOSAL, PRECOMMIT, claim);

        (
            bytes memory umaClaim,
            address recordedAsserter,
            address callbackRecipient,
            address escalationManager,
            uint64 liveness,
            IERC20 currency,
            uint256 bond,
            bytes32 identifier,
            bytes32 domainId
        ) = oracle.assertions(id);
        assertEq(umaClaim, adapter.claimText(P.CLAIM_EVIDENCE, digest));
        assertEq(recordedAsserter, asserter);
        assertEq(callbackRecipient, address(adapter));
        assertEq(escalationManager, address(0));
        assertEq(liveness, 3600);
        assertEq(address(currency), address(token));
        assertEq(bond, MIN_BOND);
        assertEq(identifier, oracle.DEFAULT_IDENTIFIER());
        assertEq(domainId, bytes32(0));
        assertEq(token.balanceOf(address(oracle)), MIN_BOND);
        assertEq(token.balanceOf(address(adapter)), 0);

        EoxContinuousAdapter.AssertionRecord memory a = adapter.assertion(id);
        assertEq(uint8(a.status), uint8(EoxContinuousAdapter.Status.Pending));
        assertEq(a.kind, P.CLAIM_EVIDENCE);
        assertEq(a.start, START);
        assertEq(a.deadline, START + 3600);
        assertEq(a.proposal, PROPOSAL);
        assertEq(a.claimDigest, digest);
        assertEq(adapter.assertionOf(digest), id);
    }

    function test_the_claim_text_states_what_makes_each_claim_true() public view {
        bytes32 digest = bytes32(uint256(0xABCD));
        string memory text = string(adapter.claimText(P.CLAIM_EVIDENCE, digest));
        assertTrue(vm.contains(text, vm.toString(digest)));
        assertTrue(vm.contains(text, vm.toString(address(adapter))));
        assertTrue(
            vm.contains(
                text,
                "this observation and assessment satisfy the identified EOX evidence policy and are supported by the committed source material."
            )
        );
        text = string(adapter.claimText(P.CLAIM_SNAPSHOT, digest));
        assertTrue(
            vm.contains(
                text,
                "this complete ordered selection follows the identified methodology's cutoff, revision and comparison rules."
            )
        );
    }

    function test_registration_is_relayed_in_the_protocol_format() public {
        vm.recordLogs();
        bytes memory claim = _evidence(CURRENT, 7);
        bytes32 digest = P.digest(P.EVIDENCE_DOMAIN, claim);
        vm.prank(asserter);
        bytes32 id = adapter.assertEvidence(PROPOSAL, PRECOMMIT, claim);

        bytes memory expected = P.encodeRegistered(
            _header(PROPOSAL, PRECOMMIT, 1),
            P.Registered({
                uma: address(oracle),
                assertionId: id,
                claimKind: P.CLAIM_EVIDENCE,
                claimDigest: digest,
                subject: digest,
                start: START,
                deadline: START + 3600
            })
        );
        (uint64[] memory numbers, bytes[] memory messages) = _messages(PROPOSAL);
        assertEq(messages.length, 1);
        assertEq(numbers[0], 1);
        assertEq(messages[0], expected);
        assertEq(adapter.messageDigest(PROPOSAL, 1), P.relayDigest(expected));

        EoxContinuousAdapter.Proposal memory p = adapter.proposal(PROPOSAL);
        assertEq(p.epoch, EPOCH);
        assertEq(p.precommitment, PRECOMMIT);
        assertEq(p.eventCount, 1);
        assertEq(p.registered, 1);
        assertEq(p.history, P.appendEvent(bytes32(0), expected));
    }

    function test_an_identical_retry_returns_the_same_assertion() public {
        bytes32 first = _assertEvidence(PROPOSAL, PRECOMMIT, CURRENT, 7);
        bytes32 again = _assertEvidence(PROPOSAL, PRECOMMIT, CURRENT, 7);
        bytes32 elsewhere = _assertEvidence(PROPOSAL_2, PRECOMMIT_2, CURRENT, 7);

        assertEq(again, first);
        assertEq(elsewhere, first);
        assertEq(token.balanceOf(address(oracle)), MIN_BOND);
        assertEq(adapter.proposal(PROPOSAL).eventCount, 1);
        assertFalse(adapter.proposal(PROPOSAL_2).exists);
    }

    function test_claims_for_another_deployment_or_epoch_are_rejected() public {
        P.ClaimContext[] memory wrong = new P.ClaimContext[](8);
        for (uint256 i; i < wrong.length; ++i) {
            wrong[i] = _context();
        }
        wrong[0].evmChainId += 1;
        wrong[1].adapter = stranger;
        wrong[2].solanaProgram = bytes32(uint256(0xEE));
        wrong[3].registry = bytes32(uint256(0xEE));
        wrong[4].epoch = EPOCH + 1;
        wrong[5].methodologyManifest = bytes32(uint256(0xEE));
        wrong[6].configurationDigest = bytes32(uint256(0xEE));
        wrong[7].evidencePolicy = bytes32(uint256(0xEE));

        for (uint256 i; i < wrong.length; ++i) {
            bytes memory claim = ClaimEncoder.evidence(_evidenceClaim(wrong[i], CURRENT, 7));
            vm.prank(asserter);
            vm.expectRevert(EoxContinuousAdapter.WrongContext.selector);
            adapter.assertEvidence(PROPOSAL, PRECOMMIT, claim);
        }
    }

    function test_only_asserters_can_assert() public {
        bytes memory claim = _evidence(CURRENT, 7);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(EoxContinuousAdapter.NotAsserter.selector, stranger));
        adapter.assertEvidence(PROPOSAL, PRECOMMIT, claim);

        bytes memory snapshot =
            _snapshot(PROPOSAL, PRECOMMIT, bytes32(uint256(1)), bytes32(uint256(2)));
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(EoxContinuousAdapter.NotAsserter.selector, stranger));
        adapter.assertSnapshot(snapshot);

        vm.prank(owner);
        adapter.setAsserter(asserter, false);
        vm.prank(asserter);
        vm.expectRevert(abi.encodeWithSelector(EoxContinuousAdapter.NotAsserter.selector, asserter));
        adapter.assertEvidence(PROPOSAL, PRECOMMIT, claim);
    }

    function test_a_proposal_keeps_its_precommitment() public {
        _assertEvidence(PROPOSAL, PRECOMMIT, CURRENT, 7);
        bytes memory other = _evidence(COMPARISON, 14);

        vm.prank(asserter);
        vm.expectRevert(
            abi.encodeWithSelector(EoxContinuousAdapter.ProposalMismatch.selector, PROPOSAL)
        );
        adapter.assertEvidence(PROPOSAL, PRECOMMIT_2, other);

        vm.prank(asserter);
        vm.expectRevert(
            abi.encodeWithSelector(EoxContinuousAdapter.ProposalMismatch.selector, bytes32(0))
        );
        adapter.assertEvidence(bytes32(0), PRECOMMIT, other);
    }

    function test_the_snapshot_registers_after_its_evidence() public {
        vm.recordLogs();
        Registered memory r = _registerProposal();

        EoxContinuousAdapter.Proposal memory p = adapter.proposal(PROPOSAL);
        assertEq(p.snapshotAssertion, r.snapshot);
        assertEq(p.evidenceListHash, keccak256(abi.encode(r.evidence)));
        assertEq(p.registered, 3);
        assertEq(p.eventCount, 3);

        EoxContinuousAdapter.AssertionRecord memory s = adapter.assertion(r.snapshot);
        assertEq(s.kind, P.CLAIM_SNAPSHOT);
        assertEq(s.proposal, PROPOSAL);

        (, bytes[] memory messages) = _messages(PROPOSAL);
        assertEq(messages.length, 3);
        assertEq(uint8(messages[2][176]), P.EVENT_REGISTERED);
        assertEq(uint8(messages[2][177 + 20 + 32]), P.CLAIM_SNAPSHOT);
    }

    function test_the_snapshot_must_bind_registered_evidence() public {
        bytes32 current = _assertEvidence(PROPOSAL, PRECOMMIT, CURRENT, 7);
        bytes32 unknown = bytes32(uint256(0x99));

        bytes memory claim = _snapshot(PROPOSAL, PRECOMMIT, current, unknown);
        vm.prank(asserter);
        vm.expectRevert(
            abi.encodeWithSelector(EoxContinuousAdapter.UnknownEvidence.selector, unknown)
        );
        adapter.assertSnapshot(claim);
    }

    function test_the_snapshot_must_match_the_registered_evidence() public {
        bytes32 current = _assertEvidence(PROPOSAL, PRECOMMIT, CURRENT, 7);
        bytes32 comparison = _assertEvidence(PROPOSAL, PRECOMMIT, COMPARISON, 14);

        ClaimEncoder.Snapshot memory s = _snapshotClaim(PROPOSAL, PRECOMMIT, current, comparison);
        s.slots[0].current.assessmentDigest = _fill(99);
        bytes memory claim = ClaimEncoder.snapshot(s);
        vm.prank(asserter);
        vm.expectRevert(
            abi.encodeWithSelector(EoxContinuousAdapter.EvidenceMismatch.selector, current)
        );
        adapter.assertSnapshot(claim);

        s = _snapshotClaim(PROPOSAL, PRECOMMIT, current, comparison);
        s.slots[0].comparison.recordId = "eox:observation:97";
        claim = ClaimEncoder.snapshot(s);
        vm.prank(asserter);
        vm.expectRevert(
            abi.encodeWithSelector(EoxContinuousAdapter.EvidenceMismatch.selector, comparison)
        );
        adapter.assertSnapshot(claim);
    }

    function test_evidence_from_another_epoch_cannot_be_reused() public {
        vm.prank(owner);
        adapter.openEpoch(EPOCH + 1, MANIFEST, CONFIG, POLICY);
        P.ClaimContext memory next = _context();
        next.epoch = EPOCH + 1;

        bytes32 current = _assertEvidence(PROPOSAL, PRECOMMIT, CURRENT, 7);
        bytes memory claim = ClaimEncoder.evidence(_evidenceClaim(next, COMPARISON, 14));
        vm.prank(asserter);
        bytes32 comparison = adapter.assertEvidence(PROPOSAL_2, PRECOMMIT_2, claim);

        bytes memory snapshot = _snapshot(PROPOSAL, PRECOMMIT, current, comparison);
        vm.prank(asserter);
        vm.expectRevert(
            abi.encodeWithSelector(EoxContinuousAdapter.EvidenceMismatch.selector, comparison)
        );
        adapter.assertSnapshot(snapshot);
    }

    function test_a_proposal_takes_one_snapshot_and_then_freezes() public {
        Registered memory r = _registerProposal();

        bytes memory retry = _snapshot(PROPOSAL, PRECOMMIT, r.current, r.comparison);
        vm.prank(asserter);
        assertEq(adapter.assertSnapshot(retry), r.snapshot);

        ClaimEncoder.Snapshot memory s =
            _snapshotClaim(PROPOSAL, PRECOMMIT, r.current, r.comparison);
        s.cutoff += 1;
        bytes memory other = ClaimEncoder.snapshot(s);
        vm.prank(asserter);
        vm.expectRevert(
            abi.encodeWithSelector(
                EoxContinuousAdapter.SnapshotAlreadyRegistered.selector, PROPOSAL, r.snapshot
            )
        );
        adapter.assertSnapshot(other);

        bytes memory late = _evidence("eox:observation:500", 40);
        vm.prank(asserter);
        vm.expectRevert(
            abi.encodeWithSelector(
                EoxContinuousAdapter.SnapshotAlreadyRegistered.selector, PROPOSAL, r.snapshot
            )
        );
        adapter.assertEvidence(PROPOSAL, PRECOMMIT, late);
    }

    function test_callbacks_come_only_from_uma_for_pending_assertions() public {
        bytes32 id = _assertEvidence(PROPOSAL, PRECOMMIT, CURRENT, 7);

        vm.prank(stranger);
        vm.expectRevert(EoxContinuousAdapter.NotOracle.selector);
        adapter.assertionResolvedCallback(id, true);

        vm.prank(stranger);
        vm.expectRevert(EoxContinuousAdapter.NotOracle.selector);
        adapter.assertionDisputedCallback(id);

        bytes32 unknown = bytes32(uint256(0x99));
        vm.prank(address(oracle));
        vm.expectRevert(
            abi.encodeWithSelector(EoxContinuousAdapter.UnknownAssertion.selector, unknown)
        );
        adapter.assertionResolvedCallback(unknown, true);

        oracle.resolve(id, true);
        vm.prank(address(oracle));
        vm.expectRevert(abi.encodeWithSelector(EoxContinuousAdapter.UnknownAssertion.selector, id));
        adapter.assertionResolvedCallback(id, false);
    }

    function test_disputes_and_settlements_are_relayed() public {
        vm.recordLogs();
        bytes memory claim = _evidence(CURRENT, 7);
        bytes32 digest = P.digest(P.EVIDENCE_DOMAIN, claim);
        vm.prank(asserter);
        bytes32 id = adapter.assertEvidence(PROPOSAL, PRECOMMIT, claim);

        vm.warp(START + 600);
        vm.prank(challenger);
        oracle.dispute(id);
        vm.warp(START + 3 days);
        oracle.resolve(id, true);

        bytes memory disputed = P.encodeDisputed(
            _header(PROPOSAL, PRECOMMIT, 2),
            P.Disputed({
                assertionId: id,
                subject: digest,
                disputeId: keccak256(abi.encode(block.chainid, address(oracle), id, challenger))
            })
        );
        bytes memory settled = P.encodeSettled(
            _header(PROPOSAL, PRECOMMIT, 3),
            P.Settled({
                assertionId: id,
                subject: digest,
                accepted: true,
                disputed: true,
                settledAt: START + 3 days
            })
        );
        (uint64[] memory numbers, bytes[] memory messages) = _messages(PROPOSAL);
        assertEq(messages.length, 3);
        assertEq(numbers[1], 2);
        assertEq(numbers[2], 3);
        assertEq(messages[1], disputed);
        assertEq(messages[2], settled);

        EoxContinuousAdapter.AssertionRecord memory a = adapter.assertion(id);
        assertEq(uint8(a.status), uint8(EoxContinuousAdapter.Status.True));
        assertTrue(a.disputed);
        assertEq(adapter.proposal(PROPOSAL).resolved, 1);
    }

    function test_closure_waits_for_every_assertion() public {
        Registered memory r = _registerProposal();
        vm.expectRevert(abi.encodeWithSelector(EoxContinuousAdapter.Unresolved.selector, PROPOSAL));
        adapter.close(PROPOSAL, r.evidence);

        vm.warp(START + 3600);
        oracle.resolve(r.current, true);
        oracle.resolve(r.snapshot, true);
        vm.expectRevert(abi.encodeWithSelector(EoxContinuousAdapter.Unresolved.selector, PROPOSAL));
        adapter.close(PROPOSAL, r.evidence);
    }

    function test_accepted_closure_commits_the_assertion_set_and_event_history() public {
        vm.recordLogs();
        Registered memory r = _registerProposal();
        vm.warp(START + 3600);
        oracle.resolve(r.current, true);
        oracle.resolve(r.comparison, true);
        oracle.resolve(r.snapshot, true);

        vm.prank(stranger);
        assertTrue(adapter.close(PROPOSAL, r.evidence));

        (uint64[] memory numbers, bytes[] memory messages) = _messages(PROPOSAL);
        assertEq(messages.length, 7);
        bytes32 history;
        for (uint256 i; i < 6; ++i) {
            assertEq(numbers[i], i + 1);
            history = P.appendEvent(history, messages[i]);
        }
        bytes memory expected = P.encodeClosed(
            _header(PROPOSAL, PRECOMMIT, 7),
            P.Closed({
                assertionSetDigest: P.assertionSetDigest(r.evidence, r.snapshot),
                eventCount: 6,
                eventDigest: history,
                accepted: true
            })
        );
        assertEq(numbers[6], 7);
        assertEq(messages[6], expected);
        assertEq(adapter.messageDigest(PROPOSAL, 7), P.relayDigest(expected));

        EoxContinuousAdapter.Proposal memory p = adapter.proposal(PROPOSAL);
        assertTrue(p.closed);
        assertTrue(p.accepted);
        assertEq(p.eventCount, 6);
        assertEq(p.history, history);
    }

    function test_a_false_evidence_assertion_rejects_the_proposal() public {
        Registered memory r = _registerProposal();
        vm.warp(START + 3600);
        oracle.resolve(r.current, true);
        oracle.resolve(r.comparison, false);
        oracle.resolve(r.snapshot, true);
        assertFalse(adapter.close(PROPOSAL, r.evidence));
        assertFalse(adapter.proposal(PROPOSAL).accepted);
    }

    function test_a_false_snapshot_assertion_rejects_the_proposal() public {
        Registered memory r = _registerProposal();
        vm.warp(START + 3600);
        oracle.resolve(r.current, true);
        oracle.resolve(r.comparison, true);
        oracle.resolve(r.snapshot, false);
        assertFalse(adapter.close(PROPOSAL, r.evidence));
    }

    function test_close_checks_the_snapshot_and_its_evidence_list() public {
        vm.expectRevert(abi.encodeWithSelector(EoxContinuousAdapter.NoSnapshot.selector, PROPOSAL));
        adapter.close(PROPOSAL, new bytes32[](0));

        Registered memory r = _registerProposal();
        vm.warp(START + 3600);
        oracle.resolve(r.current, true);
        oracle.resolve(r.comparison, true);
        oracle.resolve(r.snapshot, true);

        bytes32[] memory shortList = new bytes32[](1);
        shortList[0] = r.evidence[0];
        vm.expectRevert(
            abi.encodeWithSelector(EoxContinuousAdapter.WrongEvidenceList.selector, PROPOSAL)
        );
        adapter.close(PROPOSAL, shortList);

        adapter.close(PROPOSAL, r.evidence);
        vm.expectRevert(
            abi.encodeWithSelector(EoxContinuousAdapter.ProposalAlreadyClosed.selector, PROPOSAL)
        );
        adapter.close(PROPOSAL, r.evidence);
    }

    function test_reused_evidence_keeps_its_original_receipts() public {
        Registered memory r = _registerProposal();
        vm.warp(START + 3600);
        oracle.resolve(r.current, true);
        oracle.resolve(r.comparison, true);
        oracle.resolve(r.snapshot, true);
        adapter.close(PROPOSAL, r.evidence);

        vm.recordLogs();
        assertEq(_assertEvidence(PROPOSAL_2, PRECOMMIT_2, CURRENT, 7), r.current);
        assertEq(_assertEvidence(PROPOSAL_2, PRECOMMIT_2, COMPARISON, 14), r.comparison);

        ClaimEncoder.Snapshot memory s =
            _snapshotClaim(PROPOSAL_2, PRECOMMIT_2, r.current, r.comparison);
        s.hasPredecessor = true;
        s.predecessor = PROPOSAL;
        s.cutoff += 3600;
        bytes memory claim = ClaimEncoder.snapshot(s);
        vm.prank(asserter);
        bytes32 snapshot = adapter.assertSnapshot(claim);

        vm.warp(START + 7200);
        oracle.resolve(snapshot, true);
        assertTrue(adapter.close(PROPOSAL_2, r.evidence));

        (uint64[] memory numbers,) = _messages(PROPOSAL_2);
        assertEq(numbers.length, 3);
        assertEq(numbers[2], 3);
        assertEq(adapter.proposal(PROPOSAL_2).eventCount, 2);
        assertEq(adapter.proposal(PROPOSAL).eventCount, 6);
    }

    function test_recorded_messages_publish_to_wormhole_and_can_be_retried() public {
        vm.recordLogs();
        _assertEvidence(PROPOSAL, PRECOMMIT, CURRENT, 7);
        (, bytes[] memory messages) = _messages(PROPOSAL);

        vm.prank(stranger);
        assertEq(adapter.publish(PROPOSAL, 1, messages[0]), 0);
        (address emitter, uint32 nonce, bytes memory payload, uint8 consistency,) =
            wormhole.published(0);
        assertEq(emitter, address(adapter));
        assertEq(nonce, 0);
        assertEq(payload, messages[0]);
        assertEq(consistency, adapter.CONSISTENCY_FINALIZED());

        assertEq(adapter.publish(PROPOSAL, 1, messages[0]), 1);
        assertEq(wormhole.count(), 2);
    }

    function test_publish_sends_only_recorded_bytes_with_the_fee() public {
        vm.recordLogs();
        _assertEvidence(PROPOSAL, PRECOMMIT, CURRENT, 7);
        (, bytes[] memory messages) = _messages(PROPOSAL);
        bytes memory message = messages[0];

        vm.expectRevert(
            abi.encodeWithSelector(EoxContinuousAdapter.UnknownMessage.selector, PROPOSAL, 2)
        );
        adapter.publish(PROPOSAL, 2, message);

        bytes memory altered = bytes.concat(message, hex"00");
        vm.expectRevert(
            abi.encodeWithSelector(EoxContinuousAdapter.MessageMismatch.selector, PROPOSAL, 1)
        );
        adapter.publish(PROPOSAL, 1, altered);

        wormhole.setFee(0.001 ether);
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(EoxContinuousAdapter.WrongFee.selector, 0.001 ether, 0)
        );
        adapter.publish(PROPOSAL, 1, message);

        vm.prank(stranger);
        adapter.publish{value: 0.001 ether}(PROPOSAL, 1, message);
        assertEq(wormhole.count(), 1);
    }

    function test_the_owner_alone_opens_epochs_once_and_sets_asserters() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        adapter.openEpoch(EPOCH + 1, MANIFEST, CONFIG, POLICY);

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        adapter.setAsserter(stranger, true);

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(EoxContinuousAdapter.EpochAlreadyOpen.selector, EPOCH)
        );
        adapter.openEpoch(EPOCH, MANIFEST, CONFIG, POLICY);

        EoxContinuousAdapter.EpochConfig memory config = adapter.epochConfig(EPOCH);
        assertTrue(config.opened);
        assertEq(config.methodologyManifest, MANIFEST);
        assertEq(config.configurationDigest, CONFIG);
        assertEq(config.evidencePolicy, POLICY);
        assertEq(adapter.wormholeChain(), WORMHOLE_CHAIN);
    }

    function _registerProposal() internal returns (Registered memory r) {
        r.current = _assertEvidence(PROPOSAL, PRECOMMIT, CURRENT, 7);
        r.comparison = _assertEvidence(PROPOSAL, PRECOMMIT, COMPARISON, 14);
        bytes memory claim = _snapshot(PROPOSAL, PRECOMMIT, r.current, r.comparison);
        vm.prank(asserter);
        r.snapshot = adapter.assertSnapshot(claim);
        r.evidence = _sorted(r.current, r.comparison);
    }

    function _assertEvidence(
        bytes32 proposalId,
        bytes32 precommitment,
        string memory recordId,
        uint8 tag
    ) internal returns (bytes32) {
        bytes memory claim = _evidence(recordId, tag);
        vm.prank(asserter);
        return adapter.assertEvidence(proposalId, precommitment, claim);
    }

    function _evidence(string memory recordId, uint8 tag) internal view returns (bytes memory) {
        return ClaimEncoder.evidence(_evidenceClaim(_context(), recordId, tag));
    }

    function _evidenceClaim(P.ClaimContext memory c, string memory recordId, uint8 tag)
        internal
        pure
        returns (P.EvidenceClaim memory e)
    {
        e.context = c;
        e.evidenceDigest = _fill(tag);
        e.metadataDigest = _fill(tag + 100);
        e.recordId = recordId;
        e.artifactDigests = new bytes32[](1);
        e.artifactDigests[0] = _fill(tag + 101);
        e.assessmentDigest = _fill(tag + 1);
        e.provenanceDigests = new bytes32[](1);
        e.provenanceDigests[0] = _fill(tag + 102);
    }

    function _snapshot(
        bytes32 proposalId,
        bytes32 precommitment,
        bytes32 current,
        bytes32 comparison
    ) internal view returns (bytes memory) {
        return ClaimEncoder.snapshot(_snapshotClaim(proposalId, precommitment, current, comparison));
    }

    function _snapshotClaim(
        bytes32 proposalId,
        bytes32 precommitment,
        bytes32 current,
        bytes32 comparison
    ) internal view returns (ClaimEncoder.Snapshot memory s) {
        s.context = _context();
        s.proposal = proposalId;
        s.precommitment = precommitment;
        s.cutoff = START;
        s.slots = new ClaimEncoder.Slot[](1);
        s.slots[0].current = ClaimEncoder.Binding(CURRENT, _fill(7), _fill(8), current);
        s.slots[0].hasComparison = true;
        s.slots[0].comparison = ClaimEncoder.Binding(COMPARISON, _fill(14), _fill(15), comparison);
        s.evidenceAssertions = _sorted(current, comparison);
    }

    function _context() internal view returns (P.ClaimContext memory) {
        return P.ClaimContext({
            evmChainId: uint64(block.chainid),
            adapter: address(adapter),
            solanaProgram: PROGRAM,
            registry: REGISTRY,
            epoch: EPOCH,
            methodologyManifest: MANIFEST,
            configurationDigest: CONFIG,
            evidencePolicy: POLICY
        });
    }

    function _header(bytes32 proposalId, bytes32 precommitment, uint64 eventNumber)
        internal
        view
        returns (P.RelayHeader memory)
    {
        return P.RelayHeader({
            evmChainId: uint64(block.chainid),
            wormholeChain: WORMHOLE_CHAIN,
            adapter: address(adapter),
            solanaProgram: PROGRAM,
            registry: REGISTRY,
            epoch: EPOCH,
            proposal: proposalId,
            precommitment: precommitment,
            eventNumber: eventNumber
        });
    }

    function _messages(bytes32 proposalId)
        internal
        returns (uint64[] memory numbers, bytes[] memory messages)
    {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 count;
        for (uint256 i; i < logs.length; ++i) {
            if (_isMessage(logs[i], proposalId)) ++count;
        }
        numbers = new uint64[](count);
        messages = new bytes[](count);
        count = 0;
        for (uint256 i; i < logs.length; ++i) {
            if (!_isMessage(logs[i], proposalId)) continue;
            numbers[count] = uint64(uint256(logs[i].topics[2]));
            (, messages[count]) = abi.decode(logs[i].data, (bytes32, bytes));
            ++count;
        }
    }

    function _isMessage(Vm.Log memory log, bytes32 proposalId) internal view returns (bool) {
        return log.emitter == address(adapter)
            && log.topics[0] == EoxContinuousAdapter.RelayMessageRecorded.selector
            && log.topics[1] == proposalId;
    }

    function _sorted(bytes32 a, bytes32 b) internal pure returns (bytes32[] memory out) {
        out = new bytes32[](2);
        (out[0], out[1]) = a < b ? (a, b) : (b, a);
    }

    function _fill(uint8 b) internal pure returns (bytes32) {
        return bytes32(uint256(b) * (type(uint256).max / 255));
    }
}
