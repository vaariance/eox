// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {ContinuousProtocol as P} from "../src/ContinuousProtocol.sol";

contract ProtocolHarness {
    function decodeEvidenceClaim(bytes memory data)
        external
        pure
        returns (P.EvidenceClaim memory, bytes32)
    {
        return P.decodeEvidenceClaim(data);
    }

    function decodeSnapshotClaim(bytes memory data)
        external
        pure
        returns (P.SnapshotClaim memory, bytes32)
    {
        return P.decodeSnapshotClaim(data);
    }

    function encodeRegistered(P.RelayHeader memory h, P.Registered memory e)
        external
        pure
        returns (bytes memory)
    {
        return P.encodeRegistered(h, e);
    }

    function encodeDisputed(P.RelayHeader memory h, P.Disputed memory e)
        external
        pure
        returns (bytes memory)
    {
        return P.encodeDisputed(h, e);
    }

    function encodeSettled(P.RelayHeader memory h, P.Settled memory e)
        external
        pure
        returns (bytes memory)
    {
        return P.encodeSettled(h, e);
    }

    function encodeClosed(P.RelayHeader memory h, P.Closed memory e)
        external
        pure
        returns (bytes memory)
    {
        return P.encodeClosed(h, e);
    }

    function relayDigest(bytes memory message) external pure returns (bytes32) {
        return P.relayDigest(message);
    }

    function assertionSetDigest(bytes32[] memory evidence, bytes32 snapshot)
        external
        pure
        returns (bytes32)
    {
        return P.assertionSetDigest(evidence, snapshot);
    }

    function appendEvent(bytes32 history, bytes memory message) external pure returns (bytes32) {
        return P.appendEvent(history, message);
    }
}

contract ContinuousProtocolTest is Test {
    uint256 constant EVIDENCE = 0;
    uint256 constant SNAPSHOT_INITIAL = 1;
    uint256 constant SNAPSHOT_REUSED = 2;
    uint256 constant FIRST_RELAY = 3;

    string json;
    ProtocolHarness p;

    function setUp() public {
        json =
            vm.readFile(string.concat(vm.projectRoot(), "/../../oracle/fixtures/protocol-v1.json"));
        p = new ProtocolHarness();
    }

    function test_evidence_claim_vector() public view {
        string memory v = _vector(EVIDENCE, "evidence");
        (P.EvidenceClaim memory c, bytes32 h) = p.decodeEvidenceClaim(_encoded(v));

        assertEq(h, _sha(v));
        _assertContext(c.context, string.concat(v, ".input.context"));
        assertEq(c.evidenceDigest, _hashAt(string.concat(v, ".input.evidence_digest")));
        assertEq(c.metadataDigest, _hashAt(string.concat(v, ".input.metadata_digest")));
        assertEq(c.recordId, vm.parseJsonString(json, string.concat(v, ".input.record_id")));
        assertEq(c.artifactDigests, _hashesAt(string.concat(v, ".input.artifact_digests")));
        assertEq(c.assessmentDigest, _hashAt(string.concat(v, ".input.assessment_digest")));
        assertEq(c.provenanceDigests, _hashesAt(string.concat(v, ".input.provenance_digests")));
    }

    function test_snapshot_claim_vectors() public view {
        _assertSnapshot(_vector(SNAPSHOT_INITIAL, "snapshot-initial"), false);
        _assertSnapshot(_vector(SNAPSHOT_REUSED, "snapshot-reused-evidence"), true);
    }

    function test_relay_vectors_match_byte_for_byte() public view {
        string[9] memory names = [
            "relay-1-registered",
            "relay-2-registered",
            "relay-3-registered",
            "relay-4-disputed",
            "relay-5-settled",
            "relay-6-settled",
            "relay-7-settled",
            "relay-closed-accepted",
            "relay-settled-rejected-alternative"
        ];
        for (uint256 i; i < names.length; ++i) {
            string memory v = _vector(FIRST_RELAY + i, names[i]);
            bytes memory message = _relay(v);
            assertEq(message, _encoded(v), names[i]);
            assertEq(p.relayDigest(message), _sha(v), names[i]);
        }
    }

    function test_assertion_set_vector() public view {
        bytes32[] memory evidence = _hashesAt(".assertionSet.evidence");
        bytes32 snapshot = _hashAt(".assertionSet.snapshot");
        assertEq(p.assertionSetDigest(evidence, snapshot), _hex32(".assertionSet.sha256"));
    }

    function test_event_history_vector() public view {
        bytes32 history = _hashAt(".eventHistory.initial");
        assertEq(history, bytes32(0));
        string[] memory names = vm.parseJsonStringArray(json, ".eventHistory.vectorNames");
        string[] memory expected = vm.parseJsonStringArray(json, ".eventHistory.sha256AfterEach");
        assertEq(names.length, expected.length);
        for (uint256 i; i < names.length; ++i) {
            history = p.appendEvent(history, _relay(_vector(FIRST_RELAY + i, names[i])));
            assertEq(history, vm.parseBytes32(string.concat("0x", expected[i])), names[i]);
        }
    }

    function test_evidence_rejects_trailing_and_truncated_bytes() public {
        bytes memory e = _encoded(_vector(EVIDENCE, "evidence"));
        _rejectEvidence(abi.encodePacked(e, hex"00"));
        _rejectEvidence(_splice(e, e.length - 1, e.length, ""));
    }

    function test_evidence_rejects_other_versions() public {
        bytes memory e = _encoded(_vector(EVIDENCE, "evidence"));
        _rejectEvidence(_set(e, 0, 2));
    }

    function test_evidence_record_id_length_limits() public {
        bytes memory e = _encoded(_vector(EVIDENCE, "evidence"));
        _rejectEvidence(_withRecordId(e, ""));
        _rejectEvidence(_withRecordId(e, _ascii(257)));
        (P.EvidenceClaim memory c,) = p.decodeEvidenceClaim(_withRecordId(e, _ascii(256)));
        assertEq(bytes(c.recordId).length, 256);
    }

    function test_evidence_record_id_must_be_strict_utf8() public {
        bytes memory e = _encoded(_vector(EVIDENCE, "evidence"));
        _rejectEvidence(_set(e, 266, 0xFF));
        _rejectEvidence(_withRecordId(e, hex"C080"));
        _rejectEvidence(_withRecordId(e, hex"EDA080"));
        _rejectEvidence(_withRecordId(e, hex"F4908080"));
        _rejectEvidence(_withRecordId(e, hex"E282"));
        (P.EvidenceClaim memory c,) = p.decodeEvidenceClaim(_withRecordId(e, hex"C3A9F09F9880"));
        assertEq(bytes(c.recordId), hex"C3A9F09F9880");
    }

    function test_evidence_digest_lists_must_be_sorted_unique_and_nonempty() public {
        bytes memory e = _encoded(_vector(EVIDENCE, "evidence"));
        _rejectEvidence(_splice(e, 357, 421, abi.encodePacked(_fill(12), _fill(11))));
        _rejectEvidence(_splice(e, 357, 421, abi.encodePacked(_fill(11), _fill(11))));
        _rejectEvidence(_splice(e, 285, 321, abi.encodePacked(_le32(0))));
    }

    function test_snapshot_rejects_bad_option_tags() public {
        bytes memory s = _encoded(_vector(SNAPSHOT_INITIAL, "snapshot-initial"));
        _rejectSnapshot(_set(s, 262, 2));
        _rejectSnapshot(_set(s, 396, 2));
    }

    function test_snapshot_rejects_slots_outside_the_configuration() public {
        bytes memory s = _encoded(_vector(SNAPSHOT_INITIAL, "snapshot-initial"));
        _rejectSnapshot(_set(s, 275, 30));
        _rejectSnapshot(_set(s, 276, 32));
        _rejectSnapshot(_splice(s, 271, 515, abi.encodePacked(_le32(0))));
    }

    function test_snapshot_slots_must_be_strictly_ordered() public {
        bytes memory s = _encoded(_vector(SNAPSHOT_INITIAL, "snapshot-initial"));
        bytes memory slot = _slice(s, 275, 515);
        bytes memory next = _set(slot, 1, 1);

        _rejectSnapshot(_splice(s, 271, 515, abi.encodePacked(_le32(2), slot, slot)));
        _rejectSnapshot(_splice(s, 271, 515, abi.encodePacked(_le32(2), next, slot)));

        (P.SnapshotClaim memory c,) =
            p.decodeSnapshotClaim(_splice(s, 271, 515, abi.encodePacked(_le32(2), slot, next)));
        assertEq(c.slotCount, 2);
        assertEq(c.evidenceAssertions.length, 2);
    }

    function test_snapshot_assertion_list_must_equal_the_bound_assertions() public {
        bytes memory s = _encoded(_vector(SNAPSHOT_INITIAL, "snapshot-initial"));
        _rejectSnapshot(_splice(s, 515, 583, abi.encodePacked(_le32(1), _fill(13))));
        _rejectSnapshot(
            _splice(s, 515, 583, abi.encodePacked(_le32(3), _fill(13), _fill(16), _fill(17)))
        );
        _rejectSnapshot(_splice(s, 515, 583, abi.encodePacked(_le32(2), _fill(16), _fill(13))));
    }

    function test_snapshot_rejects_one_assertion_for_two_records() public {
        bytes memory s = _encoded(_vector(SNAPSHOT_INITIAL, "snapshot-initial"));
        _rejectSnapshot(_splice(s, 483, 583, abi.encodePacked(_fill(13), _le32(1), _fill(13))));
    }

    function test_snapshot_rejects_trailing_bytes() public {
        bytes memory s = _encoded(_vector(SNAPSHOT_INITIAL, "snapshot-initial"));
        _rejectSnapshot(abi.encodePacked(s, hex"00"));
    }

    function test_registered_requires_one_hour_liveness_and_a_known_claim_kind() public {
        string memory v = _vector(FIRST_RELAY, "relay-1-registered");
        P.RelayHeader memory h = _header(v);
        P.Registered memory e = _registered(v);

        e.deadline = e.start + 3599;
        vm.expectRevert(P.InvalidProtocolEncoding.selector);
        p.encodeRegistered(h, e);

        e = _registered(v);
        e.claimKind = 2;
        vm.expectRevert(P.InvalidProtocolEncoding.selector);
        p.encodeRegistered(h, e);
    }

    function test_event_numbers_start_at_one() public {
        string memory v = _vector(FIRST_RELAY + 3, "relay-4-disputed");
        P.RelayHeader memory h = _header(v);
        P.Disputed memory e = _disputed(v);
        h.eventNumber = 0;
        vm.expectRevert(P.InvalidProtocolEncoding.selector);
        p.encodeDisputed(h, e);
    }

    function test_closed_event_count_must_precede_its_event_number() public {
        string memory v = _vector(FIRST_RELAY + 7, "relay-closed-accepted");
        P.RelayHeader memory h = _header(v);
        P.Closed memory e = _closed(v);
        e.eventCount = 6;
        vm.expectRevert(P.InvalidProtocolEncoding.selector);
        p.encodeClosed(h, e);
    }

    function test_closure_is_excluded_from_event_history() public {
        bytes memory closed = _relay(_vector(FIRST_RELAY + 7, "relay-closed-accepted"));
        vm.expectRevert(P.InvalidProtocolEncoding.selector);
        p.appendEvent(bytes32(0), closed);

        bytes memory headerOnly = _slice(closed, 0, 176);
        vm.expectRevert(P.InvalidProtocolEncoding.selector);
        p.appendEvent(bytes32(0), headerOnly);
    }

    function test_assertion_set_rejects_invalid_lists() public {
        bytes32[] memory evidence = _hashesAt(".assertionSet.evidence");
        bytes32 snapshot = _hashAt(".assertionSet.snapshot");

        vm.expectRevert(P.InvalidProtocolEncoding.selector);
        p.assertionSetDigest(evidence, evidence[0]);

        bytes32[] memory reversed = new bytes32[](2);
        (reversed[0], reversed[1]) = (evidence[1], evidence[0]);
        vm.expectRevert(P.InvalidProtocolEncoding.selector);
        p.assertionSetDigest(reversed, snapshot);

        vm.expectRevert(P.InvalidProtocolEncoding.selector);
        p.assertionSetDigest(new bytes32[](0), snapshot);
    }

    function _assertSnapshot(string memory v, bool hasPredecessor) internal view {
        (P.SnapshotClaim memory c, bytes32 h) = p.decodeSnapshotClaim(_encoded(v));
        assertEq(h, _sha(v));
        _assertContext(c.context, string.concat(v, ".input.context"));
        assertEq(c.proposal, _hashAt(string.concat(v, ".input.proposal")));
        assertEq(c.precommitment, _hashAt(string.concat(v, ".input.precommitment")));
        assertEq(c.hasPredecessor, hasPredecessor);
        if (hasPredecessor) {
            assertEq(c.predecessor, _hashAt(string.concat(v, ".input.predecessor")));
        }
        assertEq(c.cutoff, _u64At(string.concat(v, ".input.cutoff")));
        assertEq(c.slotCount, 1);
        assertEq(c.evidenceAssertions, _hashesAt(string.concat(v, ".input.evidence_assertions")));
    }

    function _assertContext(P.ClaimContext memory c, string memory path) internal view {
        assertEq(vm.parseJsonUint(json, string.concat(path, ".version")), 1);
        assertEq(c.evmChainId, _u64At(string.concat(path, ".evm_chain_id")));
        assertEq(c.adapter, _addressAt(string.concat(path, ".adapter")));
        assertEq(c.solanaProgram, _hashAt(string.concat(path, ".solana_program")));
        assertEq(c.registry, _hashAt(string.concat(path, ".registry")));
        assertEq(c.epoch, _u64At(string.concat(path, ".epoch")));
        assertEq(c.methodologyManifest, _hashAt(string.concat(path, ".methodology_manifest")));
        assertEq(c.configurationDigest, _hashAt(string.concat(path, ".configuration_digest")));
        assertEq(c.evidencePolicy, _hashAt(string.concat(path, ".evidence_policy")));
    }

    function _relay(string memory v) internal view returns (bytes memory) {
        P.RelayHeader memory h = _header(v);
        bytes32 kind =
            keccak256(bytes(vm.parseJsonString(json, string.concat(v, ".input.event.kind"))));
        if (kind == keccak256("Registered")) return p.encodeRegistered(h, _registered(v));
        if (kind == keccak256("Disputed")) return p.encodeDisputed(h, _disputed(v));
        if (kind == keccak256("Settled")) return p.encodeSettled(h, _settled(v));
        if (kind == keccak256("Closed")) return p.encodeClosed(h, _closed(v));
        revert("unknown event kind");
    }

    function _header(string memory v) internal view returns (P.RelayHeader memory h) {
        string memory x = string.concat(v, ".input.header");
        assertEq(vm.parseJsonUint(json, string.concat(x, ".version")), 1);
        h.evmChainId = _u64At(string.concat(x, ".evm_chain_id"));
        h.wormholeChain = uint16(vm.parseJsonUint(json, string.concat(x, ".wormhole_chain")));
        h.adapter = _addressAt(string.concat(x, ".adapter"));
        h.solanaProgram = _hashAt(string.concat(x, ".solana_program"));
        h.registry = _hashAt(string.concat(x, ".registry"));
        h.epoch = _u64At(string.concat(x, ".epoch"));
        h.proposal = _hashAt(string.concat(x, ".proposal"));
        h.precommitment = _hashAt(string.concat(x, ".precommitment"));
        h.eventNumber = _u64At(string.concat(x, ".event_number"));
    }

    function _registered(string memory v) internal view returns (P.Registered memory e) {
        string memory x = string.concat(v, ".input.event");
        e.uma = _addressAt(string.concat(x, ".uma"));
        e.assertionId = _hashAt(string.concat(x, ".assertion_id"));
        bytes32 kind = keccak256(bytes(vm.parseJsonString(json, string.concat(x, ".claim_kind"))));
        e.claimKind = kind == keccak256("Evidence") ? P.CLAIM_EVIDENCE : P.CLAIM_SNAPSHOT;
        e.claimDigest = _hashAt(string.concat(x, ".claim_digest"));
        e.subject = _hashAt(string.concat(x, ".subject"));
        e.start = _u64At(string.concat(x, ".start"));
        e.deadline = _u64At(string.concat(x, ".deadline"));
    }

    function _disputed(string memory v) internal view returns (P.Disputed memory e) {
        string memory x = string.concat(v, ".input.event");
        e.assertionId = _hashAt(string.concat(x, ".assertion_id"));
        e.subject = _hashAt(string.concat(x, ".subject"));
        e.disputeId = _hashAt(string.concat(x, ".dispute_id"));
    }

    function _settled(string memory v) internal view returns (P.Settled memory e) {
        string memory x = string.concat(v, ".input.event");
        e.assertionId = _hashAt(string.concat(x, ".assertion_id"));
        e.subject = _hashAt(string.concat(x, ".subject"));
        e.accepted = vm.parseJsonBool(json, string.concat(x, ".accepted"));
        e.disputed = vm.parseJsonBool(json, string.concat(x, ".disputed"));
        e.settledAt = _u64At(string.concat(x, ".settled_at"));
    }

    function _closed(string memory v) internal view returns (P.Closed memory e) {
        string memory x = string.concat(v, ".input.event");
        e.assertionSetDigest = _hashAt(string.concat(x, ".assertion_set_digest"));
        e.eventCount = _u64At(string.concat(x, ".event_count"));
        e.eventDigest = _hashAt(string.concat(x, ".event_digest"));
        e.accepted = vm.parseJsonBool(json, string.concat(x, ".accepted"));
    }

    function _rejectEvidence(bytes memory data) internal {
        vm.expectRevert(P.InvalidProtocolEncoding.selector);
        p.decodeEvidenceClaim(data);
    }

    function _rejectSnapshot(bytes memory data) internal {
        vm.expectRevert(P.InvalidProtocolEncoding.selector);
        p.decodeSnapshotClaim(data);
    }

    function _vector(uint256 i, string memory name) internal view returns (string memory path) {
        path = string.concat(".vectors[", vm.toString(i), "]");
        assertEq(vm.parseJsonString(json, string.concat(path, ".name")), name);
    }

    function _encoded(string memory v) internal view returns (bytes memory) {
        return vm.parseBytes(
            string.concat("0x", vm.parseJsonString(json, string.concat(v, ".encodedHex")))
        );
    }

    function _sha(string memory v) internal view returns (bytes32) {
        return _hex32(string.concat(v, ".sha256"));
    }

    function _hex32(string memory path) internal view returns (bytes32) {
        return vm.parseBytes32(string.concat("0x", vm.parseJsonString(json, path)));
    }

    function _u64At(string memory path) internal view returns (uint64) {
        return SafeCast.toUint64(vm.parseUint(vm.parseJsonString(json, path)));
    }

    function _hashAt(string memory path) internal view returns (bytes32) {
        return _packed(vm.parseJsonUintArray(json, path), 32);
    }

    function _addressAt(string memory path) internal view returns (address) {
        return address(bytes20(_packed(vm.parseJsonUintArray(json, path), 20)));
    }

    function _hashesAt(string memory path) internal view returns (bytes32[] memory out) {
        uint256[][] memory raw = abi.decode(vm.parseJson(json, path), (uint256[][]));
        out = new bytes32[](raw.length);
        for (uint256 i; i < raw.length; ++i) {
            out[i] = _packed(raw[i], 32);
        }
    }

    function _packed(uint256[] memory raw, uint256 size) internal pure returns (bytes32 out) {
        assertEq(raw.length, size);
        for (uint256 i; i < size; ++i) {
            assertLe(raw[i], 255);
            out |= bytes32(raw[i] << (248 - 8 * i));
        }
    }

    function _withRecordId(bytes memory evidence, bytes memory id)
        internal
        pure
        returns (bytes memory)
    {
        return _splice(evidence, 262, 285, abi.encodePacked(_le32(uint32(id.length)), id));
    }

    function _fill(uint8 b) internal pure returns (bytes32) {
        return bytes32(uint256(b) * (type(uint256).max / 255));
    }

    function _le32(uint32 v) internal pure returns (bytes4) {
        return bytes4((v >> 24) | ((v >> 8) & 0xFF00) | ((v << 8) & 0xFF0000) | (v << 24));
    }

    function _ascii(uint256 length) internal pure returns (bytes memory out) {
        out = new bytes(length);
        for (uint256 i; i < length; ++i) {
            out[i] = "a";
        }
    }

    function _set(bytes memory data, uint256 at, uint8 value)
        internal
        pure
        returns (bytes memory out)
    {
        out = _slice(data, 0, data.length);
        out[at] = bytes1(value);
    }

    function _slice(bytes memory data, uint256 from, uint256 to)
        internal
        pure
        returns (bytes memory out)
    {
        out = new bytes(to - from);
        for (uint256 i; i < out.length; ++i) {
            out[i] = data[from + i];
        }
    }

    function _splice(bytes memory data, uint256 from, uint256 to, bytes memory insert)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodePacked(_slice(data, 0, from), insert, _slice(data, to, data.length));
    }
}
