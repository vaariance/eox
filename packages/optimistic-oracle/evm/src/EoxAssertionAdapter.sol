// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import {IOptimisticOracleV3, IOptimisticOracleV3CallbackRecipient} from "./interfaces/IOptimisticOracleV3.sol";
import {IWormhole} from "./interfaces/IWormhole.sol";

/// @title EoxAssertionAdapter
/// @notice Settles each yearly EOX epoch through UMA's Optimistic Oracle V3 and publishes the
/// result over Wormhole for the EOX Solana program.
///
/// After an epoch's evidence cutoff, anyone may assert its result: the hashes the EOX engine
/// produces from the official snapshot. The assertion goes to UMA with a bond. If nobody
/// disputes it within the liveness period, or UMA's vote upholds it, it becomes the epoch's
/// result. A false assertion clears the way for a new one until the assertion window closes.
/// Once settled, anyone may publish the result to Wormhole; the Solana program accepts only
/// messages emitted by this contract.
contract EoxAssertionAdapter is IOptimisticOracleV3CallbackRecipient, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// The claim for an epoch. Matches `ClaimBody` in the Solana program.
    struct Claim {
        bytes32 evidenceRoot;
        bytes32 methodologyImageId;
        bytes32 outputHash;
        bytes32 resolutionUriHash;
    }

    struct Epoch {
        bool opened;
        bool settled;
        bytes32 methodologyImageId;
        uint256 bond;
        bytes32 activeAssertion;
        bytes32 resultAssertion;
        Claim result;
    }

    struct Assertion {
        uint16 year;
        Claim claim;
    }

    /// How long an assertion can be disputed before it settles as true.
    uint64 public constant LIVENESS = 72 hours;
    /// How long after the cutoff new assertions are accepted. Leaves room for a dispute and
    /// UMA's vote to finish before the Solana program's result deadline.
    uint256 public constant ASSERTION_WINDOW = 21 days;
    /// Wormhole consistency level: wait for the source chain to finalize.
    uint8 public constant CONSISTENCY_FINALIZED = 1;

    /// Identifies an EOX result message, followed by the payload version.
    bytes4 public constant PAYLOAD_MAGIC = "EOXR";
    uint8 public constant PAYLOAD_VERSION = 1;

    uint256 private constant SECONDS_PER_DAY = 86_400;

    IOptimisticOracleV3 public immutable oracle;
    IWormhole public immutable wormhole;
    IERC20 public immutable bondCurrency;
    bytes32 public immutable identifier;

    mapping(uint16 year => Epoch) private _epochs;
    mapping(bytes32 assertionId => Assertion) private _assertions;

    event EpochOpened(uint16 indexed year, bytes32 methodologyImageId, uint256 bond);
    event ResultAsserted(uint16 indexed year, bytes32 indexed assertionId, address indexed asserter, Claim claim);
    event AssertionDisputed(uint16 indexed year, bytes32 indexed assertionId);
    event AssertionRejected(uint16 indexed year, bytes32 indexed assertionId);
    event EpochSettled(uint16 indexed year, bytes32 indexed assertionId, Claim result);
    event ResultPublished(uint16 indexed year, uint64 sequence);

    error EpochAlreadyOpen(uint16 year);
    error EpochNotOpen(uint16 year);
    error EpochAlreadySettled(uint16 year);
    error EpochNotSettled(uint16 year);
    error BondBelowMinimum(uint256 bond, uint256 minimum);
    error TooEarly(uint256 cutoff);
    error AssertionWindowClosed(uint256 closedAt);
    error AssertionPending(bytes32 assertionId);
    error WrongMethodology(bytes32 expected, bytes32 given);
    error NotOracle();
    error UnknownAssertion(bytes32 assertionId);
    error WrongFee(uint256 expected, uint256 given);
    error ResolutionUriMismatch();

    modifier onlyOracle() {
        _onlyOracle();
        _;
    }

    constructor(IOptimisticOracleV3 oracle_, IWormhole wormhole_, IERC20 bondCurrency_, address owner_)
        Ownable(owner_)
    {
        oracle = oracle_;
        wormhole = wormhole_;
        bondCurrency = bondCurrency_;
        identifier = oracle_.defaultIdentifier();
    }

    // ------------------------------------------------------------------ epochs

    /// Opens `year` for assertions, pinning the methodology the result must be computed with.
    function openEpoch(uint16 year, bytes32 methodologyImageId, uint256 bond) external onlyOwner {
        Epoch storage epoch = _epochs[year];
        if (epoch.opened) revert EpochAlreadyOpen(year);
        uint256 minimum = oracle.getMinimumBond(address(bondCurrency));
        if (bond < minimum) revert BondBelowMinimum(bond, minimum);

        epoch.opened = true;
        epoch.methodologyImageId = methodologyImageId;
        epoch.bond = bond;
        emit EpochOpened(year, methodologyImageId, bond);
    }

    /// Asserts `claim` as the result for `year`. The caller posts the epoch's bond, which UMA
    /// returns to them if the assertion holds. `resolutionUri` is where the snapshot and output
    /// bundle are published; its SHA-256 must equal `claim.resolutionUriHash`.
    function assertResult(uint16 year, Claim calldata claim, string calldata resolutionUri)
        external
        nonReentrant
        returns (bytes32 assertionId)
    {
        Epoch storage epoch = _epochs[year];
        if (!epoch.opened) revert EpochNotOpen(year);
        if (epoch.settled) revert EpochAlreadySettled(year);
        if (epoch.activeAssertion != bytes32(0)) revert AssertionPending(epoch.activeAssertion);

        uint256 cutoff = cutoffTimestamp(year);
        if (block.timestamp < cutoff) revert TooEarly(cutoff);
        if (block.timestamp > cutoff + ASSERTION_WINDOW) revert AssertionWindowClosed(cutoff + ASSERTION_WINDOW);
        if (claim.methodologyImageId != epoch.methodologyImageId) {
            revert WrongMethodology(epoch.methodologyImageId, claim.methodologyImageId);
        }
        if (sha256(bytes(resolutionUri)) != claim.resolutionUriHash) revert ResolutionUriMismatch();

        uint256 bond = epoch.bond;
        bondCurrency.safeTransferFrom(msg.sender, address(this), bond);
        bondCurrency.forceApprove(address(oracle), bond);

        assertionId = oracle.assertTruth(
            claimText(year, claim, resolutionUri),
            msg.sender,
            address(this),
            address(0),
            LIVENESS,
            bondCurrency,
            bond,
            identifier,
            bytes32(0)
        );

        epoch.activeAssertion = assertionId;
        _assertions[assertionId] = Assertion({year: year, claim: claim});
        emit ResultAsserted(year, assertionId, msg.sender, claim);
    }

    /// Publishes a settled epoch's result to Wormhole. Anyone may call it, and may call it again
    /// if a message is lost; the Solana program records a result only once.
    function publishResult(uint16 year) external payable nonReentrant returns (uint64 sequence) {
        if (!_epochs[year].settled) revert EpochNotSettled(year);
        uint256 fee = wormhole.messageFee();
        if (msg.value != fee) revert WrongFee(fee, msg.value);

        sequence = wormhole.publishMessage{value: fee}(0, resultPayload(year), CONSISTENCY_FINALIZED);
        emit ResultPublished(year, sequence);
    }

    // ------------------------------------------------------------------ oracle callbacks

    function assertionResolvedCallback(bytes32 assertionId, bool assertedTruthfully) external onlyOracle {
        Assertion storage assertion = _assertions[assertionId];
        uint16 year = assertion.year;
        Epoch storage epoch = _epochs[year];
        if (epoch.activeAssertion != assertionId) revert UnknownAssertion(assertionId);

        epoch.activeAssertion = bytes32(0);
        if (assertedTruthfully) {
            epoch.settled = true;
            epoch.resultAssertion = assertionId;
            epoch.result = assertion.claim;
            emit EpochSettled(year, assertionId, assertion.claim);
        } else {
            emit AssertionRejected(year, assertionId);
        }
    }

    function assertionDisputedCallback(bytes32 assertionId) external onlyOracle {
        uint16 year = _assertions[assertionId].year;
        if (_epochs[year].activeAssertion != assertionId) revert UnknownAssertion(assertionId);
        emit AssertionDisputed(year, assertionId);
    }

    // ------------------------------------------------------------------ views

    function epochs(uint16 year) external view returns (Epoch memory) {
        return _epochs[year];
    }

    /// The Wormhole payload for a settled epoch, read by the Solana program:
    /// "EOXR" | version (1) | year (2, big-endian) | evidence root | methodology image ID |
    /// output hash | resolution URI hash | UMA assertion ID. 167 bytes.
    function resultPayload(uint16 year) public view returns (bytes memory) {
        Epoch storage epoch = _epochs[year];
        if (!epoch.settled) revert EpochNotSettled(year);
        Claim storage r = epoch.result;
        return abi.encodePacked(
            PAYLOAD_MAGIC,
            PAYLOAD_VERSION,
            year,
            r.evidenceRoot,
            r.methodologyImageId,
            r.outputHash,
            r.resolutionUriHash,
            epoch.resultAssertion
        );
    }

    /// The text UMA voters see if an assertion is disputed. It states exactly what makes the
    /// assertion true, so a voter can check it by re-running the engine.
    function claimText(uint16 year, Claim calldata claim, string calldata resolutionUri)
        public
        pure
        returns (bytes memory)
    {
        string memory y = Strings.toString(year);
        return bytes.concat(
            "EOX yearly result for epoch ",
            bytes(y),
            ". Evidence root: ",
            bytes(_hex(claim.evidenceRoot)),
            ". Methodology image ID: ",
            bytes(_hex(claim.methodologyImageId)),
            ". Output hash: ",
            bytes(_hex(claim.outputHash)),
            ". Snapshot and output bundle: ",
            bytes(resolutionUri),
            ". This assertion is true if and only if the evidence root is the eox-engine Merkle root of the official observations for ",
            bytes(y),
            " known at the evidence cutoff (31 July ",
            bytes(Strings.toString(uint256(year) + 1)),
            ", 00:00 UTC), and running the methodology with that image ID over that snapshot produces exactly that output hash."
        );
    }

    /// 31 July of the year after `year`, 00:00 UTC. Matches `cutoff_timestamp` in the Solana
    /// program and the engine's evidence cutoff.
    function cutoffTimestamp(uint16 year) public pure returns (uint256) {
        // Days since 1970-01-01 for (year + 1)-07-31, Howard Hinnant's days_from_civil. July is
        // after February, so the year needs no adjustment.
        uint256 y = uint256(year) + 1;
        uint256 era = y / 400;
        uint256 yearOfEra = y - era * 400;
        // Day of the March-based year for 31 July: (153 * (7 - 3) + 2) / 5 + 31 - 1, in integers.
        uint256 dayOfYear = 152;
        uint256 dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear;
        return (era * 146_097 + dayOfEra - 719_468) * SECONDS_PER_DAY;
    }

    function _onlyOracle() private view {
        if (msg.sender != address(oracle)) revert NotOracle();
    }

    function _hex(bytes32 value) private pure returns (string memory) {
        return Strings.toHexString(uint256(value), 32);
    }
}
