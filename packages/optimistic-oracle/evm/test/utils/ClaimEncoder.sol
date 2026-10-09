// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ContinuousProtocol as P} from "../../src/ContinuousProtocol.sol";

library ClaimEncoder {
    struct Binding {
        string recordId;
        bytes32 evidenceDigest;
        bytes32 assessmentDigest;
        bytes32 assertionId;
    }

    struct Slot {
        uint8 country;
        uint8 indicator;
        Binding current;
        bool hasComparison;
        Binding comparison;
    }

    struct Snapshot {
        P.ClaimContext context;
        bytes32 proposal;
        bytes32 precommitment;
        bool hasPredecessor;
        bytes32 predecessor;
        uint64 cutoff;
        Slot[] slots;
        bytes32[] evidenceAssertions;
    }

    function context(P.ClaimContext memory c) internal pure returns (bytes memory) {
        return abi.encodePacked(
            le16(P.VERSION),
            le64(c.evmChainId),
            c.adapter,
            c.solanaProgram,
            c.registry,
            le64(c.epoch),
            c.methodologyManifest,
            c.configurationDigest,
            c.evidencePolicy
        );
    }

    function evidence(P.EvidenceClaim memory c) internal pure returns (bytes memory) {
        return abi.encodePacked(
            context(c.context),
            c.evidenceDigest,
            c.metadataDigest,
            text(c.recordId),
            hashes(c.artifactDigests),
            c.assessmentDigest,
            hashes(c.provenanceDigests)
        );
    }

    function snapshot(Snapshot memory s) internal pure returns (bytes memory) {
        bytes memory slots;
        for (uint256 i; i < s.slots.length; ++i) {
            Slot memory slot = s.slots[i];
            slots = abi.encodePacked(
                slots,
                slot.country,
                slot.indicator,
                binding(slot.current),
                slot.hasComparison,
                slot.hasComparison ? binding(slot.comparison) : bytes("")
            );
        }
        return abi.encodePacked(
            context(s.context),
            s.proposal,
            s.precommitment,
            s.hasPredecessor,
            s.hasPredecessor ? abi.encodePacked(s.predecessor) : bytes(""),
            le64(s.cutoff),
            le32(uint32(s.slots.length)),
            slots,
            hashes(s.evidenceAssertions)
        );
    }

    function binding(Binding memory b) internal pure returns (bytes memory) {
        return
            abi.encodePacked(text(b.recordId), b.evidenceDigest, b.assessmentDigest, b.assertionId);
    }

    function text(string memory s) internal pure returns (bytes memory) {
        return abi.encodePacked(le32(uint32(bytes(s).length)), s);
    }

    function hashes(bytes32[] memory values) internal pure returns (bytes memory) {
        return abi.encodePacked(le32(uint32(values.length)), values);
    }

    function le16(uint16 v) internal pure returns (bytes2) {
        return bytes2((v >> 8) | (v << 8));
    }

    function le32(uint32 v) internal pure returns (bytes4) {
        return bytes4((v >> 24) | ((v >> 8) & 0xFF00) | ((v << 8) & 0xFF0000) | (v << 24));
    }

    function le64(uint64 v) internal pure returns (bytes8) {
        v = ((v & 0xFF00FF00FF00FF00) >> 8) | ((v & 0x00FF00FF00FF00FF) << 8);
        v = ((v & 0xFFFF0000FFFF0000) >> 16) | ((v & 0x0000FFFF0000FFFF) << 16);
        return bytes8((v >> 32) | (v << 32));
    }
}
