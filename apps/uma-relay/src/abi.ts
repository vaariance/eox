import { parseAbi } from "viem";

export const adapterAbi = parseAbi([
  "struct Proposal { bool exists; bool closed; bool accepted; uint64 epoch; uint64 eventCount; uint32 registered; uint32 resolved; bytes32 precommitment; bytes32 history; bytes32 snapshotAssertion; bytes32 evidenceListHash; }",
  "struct AssertionRecord { uint8 kind; uint8 status; bool disputed; uint64 start; uint64 deadline; bytes32 proposal; bytes32 claimDigest; bytes32 contextHash; bytes32 binding; }",
  "function oracle() view returns (address)",
  "function bondCurrency() view returns (address)",
  "function assertionOf(bytes32 claimDigest) view returns (bytes32)",
  "function assertEvidence(bytes32 proposalId, bytes32 precommitment, bytes claim) returns (bytes32 assertionId)",
  "function assertSnapshot(bytes claim) returns (bytes32 assertionId)",
  "function wormhole() view returns (address)",
  "function proposal(bytes32 proposalId) view returns (Proposal)",
  "function assertion(bytes32 assertionId) view returns (AssertionRecord)",
  "function messageDigest(bytes32 proposalId, uint64 eventNumber) view returns (bytes32)",
  "function close(bytes32 proposalId, bytes32[] evidence) returns (bool accepted)",
  "function publish(bytes32 proposalId, uint64 eventNumber, bytes message) payable returns (uint64 sequence)",
  "event ClaimAsserted(bytes32 indexed proposal, bytes32 indexed assertionId, uint8 kind, bytes32 claimDigest, bytes claim)",
  "event RelayMessageRecorded(bytes32 indexed proposal, uint64 indexed eventNumber, bytes32 digest, bytes message)",
  "event RelayMessagePublished(bytes32 indexed proposal, uint64 indexed eventNumber, uint64 sequence)",
  "event ProposalClosed(bytes32 indexed proposal, bool accepted)",
  "error InvalidProtocolEncoding()",
  "error NotAsserter(address account)",
  "error WrongContext()",
  "error ProposalMismatch(bytes32 proposal)",
  "error SnapshotAlreadyRegistered(bytes32 proposal, bytes32 assertionId)",
  "error UnknownEvidence(bytes32 assertionId)",
  "error EvidenceMismatch(bytes32 assertionId)",
]);

export const oracleAbi = parseAbi([
  "function settleAssertion(bytes32 assertionId)",
  "function getMinimumBond(address currency) view returns (uint256)",
]);

export const wormholeAbi = parseAbi(["function messageFee() view returns (uint256)"]);

export const CLAIM_SNAPSHOT = 1;
export const STATUS_PENDING = 1;
