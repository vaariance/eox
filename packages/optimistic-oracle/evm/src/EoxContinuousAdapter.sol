// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import {ContinuousProtocol as P} from "./ContinuousProtocol.sol";
import {
    IOptimisticOracleV3,
    IOptimisticOracleV3CallbackRecipient
} from "./interfaces/IOptimisticOracleV3.sol";
import {IWormhole} from "./interfaces/IWormhole.sol";

contract EoxContinuousAdapter is
    IOptimisticOracleV3CallbackRecipient,
    Ownable2Step,
    ReentrancyGuard
{
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Pending,
        True,
        False
    }

    struct EpochConfig {
        bool opened;
        bytes32 methodologyManifest;
        bytes32 configurationDigest;
        bytes32 evidencePolicy;
    }

    struct Proposal {
        bool exists;
        bool closed;
        bool accepted;
        uint64 epoch;
        uint64 eventCount;
        uint32 registered;
        uint32 resolved;
        bytes32 precommitment;
        bytes32 history;
        bytes32 snapshotAssertion;
        bytes32 evidenceListHash;
    }

    struct AssertionRecord {
        uint8 kind;
        Status status;
        bool disputed;
        uint64 start;
        uint64 deadline;
        bytes32 proposal;
        bytes32 claimDigest;
        bytes32 contextHash;
        bytes32 binding;
    }

    uint64 public constant LIVENESS = P.LIVENESS;
    uint8 public constant CONSISTENCY_FINALIZED = 1;

    bytes private constant EVIDENCE_STATEMENT =
        "this observation and assessment satisfy the identified EOX evidence policy and are supported by the committed source material.";
    bytes private constant SNAPSHOT_STATEMENT =
        "this complete ordered selection follows the identified methodology's cutoff, revision and comparison rules.";

    IOptimisticOracleV3 public immutable oracle;
    IWormhole public immutable wormhole;
    IERC20 public immutable bondCurrency;
    bytes32 public immutable identifier;
    bytes32 public immutable solanaProgram;
    bytes32 public immutable registry;
    uint16 public immutable wormholeChain;

    mapping(uint64 epoch => EpochConfig) private _epochs;
    mapping(bytes32 proposal => Proposal) private _proposals;
    mapping(bytes32 assertionId => AssertionRecord) private _assertions;
    mapping(bytes32 claimDigest => bytes32 assertionId) public assertionOf;
    mapping(bytes32 proposal => mapping(uint64 eventNumber => bytes32 digest)) public messageDigest;
    mapping(address account => bool) public asserters;

    event EpochOpened(
        uint64 indexed epoch,
        bytes32 methodologyManifest,
        bytes32 configurationDigest,
        bytes32 evidencePolicy
    );
    event AsserterSet(address indexed account, bool allowed);
    event ProposalOpened(bytes32 indexed proposal, uint64 indexed epoch, bytes32 precommitment);
    event ClaimAsserted(
        bytes32 indexed proposal,
        bytes32 indexed assertionId,
        uint8 kind,
        bytes32 claimDigest,
        bytes claim
    );
    event RelayMessageRecorded(
        bytes32 indexed proposal, uint64 indexed eventNumber, bytes32 digest, bytes message
    );
    event RelayMessagePublished(
        bytes32 indexed proposal, uint64 indexed eventNumber, uint64 sequence
    );
    event ProposalClosed(bytes32 indexed proposal, bool accepted);

    error NotAsserter(address account);
    error NotOracle();
    error EpochAlreadyOpen(uint64 epoch);
    error WrongContext();
    error ProposalMismatch(bytes32 proposal);
    error SnapshotAlreadyRegistered(bytes32 proposal, bytes32 assertionId);
    error UnknownEvidence(bytes32 assertionId);
    error EvidenceMismatch(bytes32 assertionId);
    error UnknownAssertion(bytes32 assertionId);
    error NoSnapshot(bytes32 proposal);
    error ProposalAlreadyClosed(bytes32 proposal);
    error WrongEvidenceList(bytes32 proposal);
    error Unresolved(bytes32 proposal);
    error UnknownMessage(bytes32 proposal, uint64 eventNumber);
    error MessageMismatch(bytes32 proposal, uint64 eventNumber);
    error WrongFee(uint256 expected, uint256 given);

    modifier onlyAsserter() {
        _onlyAsserter();
        _;
    }

    modifier onlyOracle() {
        _onlyOracle();
        _;
    }

    constructor(
        IOptimisticOracleV3 oracle_,
        IWormhole wormhole_,
        IERC20 bondCurrency_,
        bytes32 solanaProgram_,
        bytes32 registry_,
        address owner_
    ) Ownable(owner_) {
        oracle = oracle_;
        wormhole = wormhole_;
        bondCurrency = bondCurrency_;
        identifier = oracle_.defaultIdentifier();
        solanaProgram = solanaProgram_;
        registry = registry_;
        wormholeChain = wormhole_.chainId();
    }

    function openEpoch(
        uint64 epoch,
        bytes32 methodologyManifest,
        bytes32 configurationDigest,
        bytes32 evidencePolicy
    ) external onlyOwner {
        EpochConfig storage config = _epochs[epoch];
        if (config.opened) revert EpochAlreadyOpen(epoch);
        config.opened = true;
        config.methodologyManifest = methodologyManifest;
        config.configurationDigest = configurationDigest;
        config.evidencePolicy = evidencePolicy;
        emit EpochOpened(epoch, methodologyManifest, configurationDigest, evidencePolicy);
    }

    function setAsserter(address account, bool allowed) external onlyOwner {
        asserters[account] = allowed;
        emit AsserterSet(account, allowed);
    }

    function assertEvidence(bytes32 proposalId, bytes32 precommitment, bytes calldata claim)
        external
        nonReentrant
        onlyAsserter
        returns (bytes32 assertionId)
    {
        (P.EvidenceClaim memory c, bytes32 claimDigest) = P.decodeEvidenceClaim(claim);
        assertionId = assertionOf[claimDigest];
        if (assertionId != bytes32(0)) return assertionId;

        _checkContext(c.context);
        Proposal storage p = _openProposal(proposalId, precommitment, c.context.epoch);
        assertionId = _assert(proposalId, p, P.CLAIM_EVIDENCE, claimDigest, claim);

        AssertionRecord storage a = _assertions[assertionId];
        a.contextHash = keccak256(abi.encode(c.context));
        a.binding = P.bindingIdentity(c.recordId, c.evidenceDigest, c.assessmentDigest, assertionId);
    }

    function assertSnapshot(bytes calldata claim)
        external
        nonReentrant
        onlyAsserter
        returns (bytes32 assertionId)
    {
        (P.SnapshotClaim memory c, bytes32 claimDigest) = P.decodeSnapshotClaim(claim);
        assertionId = assertionOf[claimDigest];
        if (assertionId != bytes32(0)) return assertionId;

        _checkContext(c.context);
        Proposal storage p = _openProposal(c.proposal, c.precommitment, c.context.epoch);
        _checkEvidence(c);

        assertionId = _assert(c.proposal, p, P.CLAIM_SNAPSHOT, claimDigest, claim);
        p.snapshotAssertion = assertionId;
        p.evidenceListHash = keccak256(abi.encode(c.evidenceAssertions));
    }

    function close(bytes32 proposalId, bytes32[] calldata evidence)
        external
        returns (bool accepted)
    {
        Proposal storage p = _proposals[proposalId];
        bytes32 snapshot = p.snapshotAssertion;
        if (snapshot == bytes32(0)) revert NoSnapshot(proposalId);
        if (p.closed) revert ProposalAlreadyClosed(proposalId);
        if (keccak256(abi.encode(evidence)) != p.evidenceListHash) {
            revert WrongEvidenceList(proposalId);
        }
        if (p.resolved != p.registered) revert Unresolved(proposalId);

        accepted = _assertions[snapshot].status == Status.True;
        for (uint256 i; i < evidence.length; ++i) {
            Status status = _assertions[evidence[i]].status;
            if (status == Status.Pending) revert Unresolved(proposalId);
            if (status == Status.False) accepted = false;
        }

        p.closed = true;
        p.accepted = accepted;
        uint64 eventNumber = p.eventCount + 1;
        bytes memory message = P.encodeClosed(
            _header(proposalId, p, eventNumber),
            P.Closed({
                assertionSetDigest: P.assertionSetDigest(evidence, snapshot),
                eventCount: p.eventCount,
                eventDigest: p.history,
                accepted: accepted
            })
        );
        _store(proposalId, eventNumber, message);
        emit ProposalClosed(proposalId, accepted);
    }

    function publish(bytes32 proposalId, uint64 eventNumber, bytes calldata message)
        external
        payable
        nonReentrant
        returns (uint64 sequence)
    {
        bytes32 recorded = messageDigest[proposalId][eventNumber];
        if (recorded == bytes32(0)) revert UnknownMessage(proposalId, eventNumber);
        if (P.relayDigest(message) != recorded) revert MessageMismatch(proposalId, eventNumber);
        uint256 fee = wormhole.messageFee();
        if (msg.value != fee) revert WrongFee(fee, msg.value);

        sequence = wormhole.publishMessage{value: fee}(0, message, CONSISTENCY_FINALIZED);
        emit RelayMessagePublished(proposalId, eventNumber, sequence);
    }

    function assertionDisputedCallback(bytes32 assertionId) external onlyOracle {
        AssertionRecord storage a = _pending(assertionId);
        a.disputed = true;
        address disputer = oracle.getAssertion(assertionId).disputer;
        _record(
            a.proposal,
            P.encodeDisputed(
                _nextHeader(a.proposal),
                P.Disputed({
                    assertionId: assertionId,
                    subject: a.claimDigest,
                    disputeId: keccak256(
                        abi.encode(block.chainid, address(oracle), assertionId, disputer)
                    )
                })
            )
        );
    }

    function assertionResolvedCallback(bytes32 assertionId, bool assertedTruthfully)
        external
        onlyOracle
    {
        AssertionRecord storage a = _pending(assertionId);
        a.status = assertedTruthfully ? Status.True : Status.False;
        _proposals[a.proposal].resolved += 1;
        _record(
            a.proposal,
            P.encodeSettled(
                _nextHeader(a.proposal),
                P.Settled({
                    assertionId: assertionId,
                    subject: a.claimDigest,
                    accepted: assertedTruthfully,
                    disputed: a.disputed,
                    settledAt: SafeCast.toUint64(block.timestamp)
                })
            )
        );
    }

    function epochConfig(uint64 epoch) external view returns (EpochConfig memory) {
        return _epochs[epoch];
    }

    function proposal(bytes32 proposalId) external view returns (Proposal memory) {
        return _proposals[proposalId];
    }

    function assertion(bytes32 assertionId) external view returns (AssertionRecord memory) {
        return _assertions[assertionId];
    }

    function claimText(uint8 kind, bytes32 claimDigest) public view returns (bytes memory) {
        bool evidence = kind == P.CLAIM_EVIDENCE;
        return bytes.concat(
            "EOX continuous ",
            evidence ? bytes("evidence") : bytes("snapshot"),
            " claim ",
            bytes(Strings.toHexString(uint256(claimDigest), 32)),
            ". The claim is the Borsh payload with that EOX/ORACLE/V1 commitment, emitted in the ClaimAsserted event of adapter ",
            bytes(Strings.toChecksumHexString(address(this))),
            " on EVM chain ",
            bytes(Strings.toString(block.chainid)),
            ". This assertion is true if and only if ",
            evidence ? EVIDENCE_STATEMENT : SNAPSHOT_STATEMENT
        );
    }

    function _assert(
        bytes32 proposalId,
        Proposal storage p,
        uint8 kind,
        bytes32 claimDigest,
        bytes calldata claim
    ) private returns (bytes32 assertionId) {
        uint256 bond = oracle.getMinimumBond(address(bondCurrency));
        bondCurrency.safeTransferFrom(msg.sender, address(this), bond);
        bondCurrency.forceApprove(address(oracle), bond);
        assertionId = oracle.assertTruth(
            claimText(kind, claimDigest),
            msg.sender,
            address(this),
            address(0),
            LIVENESS,
            bondCurrency,
            bond,
            identifier,
            bytes32(0)
        );
        IOptimisticOracleV3.Assertion memory u = oracle.getAssertion(assertionId);

        assertionOf[claimDigest] = assertionId;
        AssertionRecord storage a = _assertions[assertionId];
        a.kind = kind;
        a.status = Status.Pending;
        a.start = u.assertionTime;
        a.deadline = u.expirationTime;
        a.proposal = proposalId;
        a.claimDigest = claimDigest;
        p.registered += 1;
        emit ClaimAsserted(proposalId, assertionId, kind, claimDigest, claim);

        _record(
            proposalId,
            P.encodeRegistered(
                _nextHeader(proposalId),
                P.Registered({
                    uma: address(oracle),
                    assertionId: assertionId,
                    claimKind: kind,
                    claimDigest: claimDigest,
                    subject: claimDigest,
                    start: u.assertionTime,
                    deadline: u.expirationTime
                })
            )
        );
    }

    function _checkContext(P.ClaimContext memory c) private view {
        EpochConfig storage config = _epochs[c.epoch];
        if (
            !config.opened || c.evmChainId != block.chainid || c.adapter != address(this)
                || c.solanaProgram != solanaProgram || c.registry != registry
                || c.methodologyManifest != config.methodologyManifest
                || c.configurationDigest != config.configurationDigest
                || c.evidencePolicy != config.evidencePolicy
        ) revert WrongContext();
    }

    function _checkEvidence(P.SnapshotClaim memory c) private view {
        bytes32 contextHash = keccak256(abi.encode(c.context));
        for (uint256 i; i < c.evidenceAssertions.length; ++i) {
            bytes32 id = c.evidenceAssertions[i];
            AssertionRecord storage e = _assertions[id];
            if (e.status == Status.None || e.kind != P.CLAIM_EVIDENCE) revert UnknownEvidence(id);
            if (e.contextHash != contextHash || e.binding != c.bindingIdentities[i]) {
                revert EvidenceMismatch(id);
            }
        }
    }

    function _openProposal(bytes32 proposalId, bytes32 precommitment, uint64 epoch)
        private
        returns (Proposal storage p)
    {
        if (proposalId == bytes32(0)) revert ProposalMismatch(proposalId);
        p = _proposals[proposalId];
        if (!p.exists) {
            p.exists = true;
            p.epoch = epoch;
            p.precommitment = precommitment;
            emit ProposalOpened(proposalId, epoch, precommitment);
        } else if (p.precommitment != precommitment || p.epoch != epoch) {
            revert ProposalMismatch(proposalId);
        }
        if (p.snapshotAssertion != bytes32(0)) {
            revert SnapshotAlreadyRegistered(proposalId, p.snapshotAssertion);
        }
    }

    function _onlyAsserter() private view {
        if (!asserters[msg.sender]) revert NotAsserter(msg.sender);
    }

    function _onlyOracle() private view {
        if (msg.sender != address(oracle)) revert NotOracle();
    }

    function _pending(bytes32 assertionId) private view returns (AssertionRecord storage a) {
        a = _assertions[assertionId];
        if (a.status != Status.Pending) revert UnknownAssertion(assertionId);
    }

    function _nextHeader(bytes32 proposalId) private returns (P.RelayHeader memory) {
        Proposal storage p = _proposals[proposalId];
        p.eventCount += 1;
        return _header(proposalId, p, p.eventCount);
    }

    function _header(bytes32 proposalId, Proposal storage p, uint64 eventNumber)
        private
        view
        returns (P.RelayHeader memory)
    {
        return P.RelayHeader({
            evmChainId: SafeCast.toUint64(block.chainid),
            wormholeChain: wormholeChain,
            adapter: address(this),
            solanaProgram: solanaProgram,
            registry: registry,
            epoch: p.epoch,
            proposal: proposalId,
            precommitment: p.precommitment,
            eventNumber: eventNumber
        });
    }

    function _record(bytes32 proposalId, bytes memory message) private {
        Proposal storage p = _proposals[proposalId];
        p.history = P.appendEvent(p.history, message);
        _store(proposalId, p.eventCount, message);
    }

    function _store(bytes32 proposalId, uint64 eventNumber, bytes memory message) private {
        bytes32 digest = P.relayDigest(message);
        messageDigest[proposalId][eventNumber] = digest;
        emit RelayMessageRecorded(proposalId, eventNumber, digest, message);
    }
}
