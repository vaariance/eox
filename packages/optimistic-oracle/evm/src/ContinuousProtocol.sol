// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library ContinuousProtocol {
    uint16 internal constant VERSION = 1;
    uint64 internal constant LIVENESS = 3600;

    uint8 internal constant CLAIM_EVIDENCE = 0;
    uint8 internal constant CLAIM_SNAPSHOT = 1;

    uint8 internal constant EVENT_REGISTERED = 0;
    uint8 internal constant EVENT_DISPUTED = 1;
    uint8 internal constant EVENT_SETTLED = 2;
    uint8 internal constant EVENT_CLOSED = 3;

    uint256 internal constant MAX_COUNTRIES = 30;
    uint256 internal constant MAX_INDICATORS = 32;
    uint256 internal constant MAX_SLOTS = 960;
    uint256 internal constant MAX_EVIDENCE_ASSERTIONS = 1920;
    uint256 internal constant MAX_DIGESTS = 64;
    uint256 internal constant MAX_RECORD_ID = 256;
    uint256 internal constant HEADER_LENGTH = 176;

    bytes internal constant PREFIX = "EOX/ORACLE/V1\x00";
    bytes internal constant EVIDENCE_DOMAIN = "continuous-evidence-claim-v1";
    bytes internal constant SNAPSHOT_DOMAIN = "continuous-snapshot-claim-v1";
    bytes internal constant RELAY_DOMAIN = "continuous-relay-v1";
    bytes internal constant ASSERTIONS_DOMAIN = "continuous-assertion-set-v1";
    bytes internal constant EVENTS_DOMAIN = "continuous-event-history-v1";

    error InvalidProtocolEncoding();

    struct ClaimContext {
        uint64 evmChainId;
        address adapter;
        bytes32 solanaProgram;
        bytes32 registry;
        uint64 epoch;
        bytes32 methodologyManifest;
        bytes32 configurationDigest;
        bytes32 evidencePolicy;
    }

    struct EvidenceClaim {
        ClaimContext context;
        bytes32 evidenceDigest;
        bytes32 metadataDigest;
        string recordId;
        bytes32[] artifactDigests;
        bytes32 assessmentDigest;
        bytes32[] provenanceDigests;
    }

    struct SnapshotClaim {
        ClaimContext context;
        bytes32 proposal;
        bytes32 precommitment;
        bool hasPredecessor;
        bytes32 predecessor;
        uint64 cutoff;
        uint32 slotCount;
        bytes32[] evidenceAssertions;
        bytes32[] bindingIdentities;
    }

    struct RelayHeader {
        uint64 evmChainId;
        uint16 wormholeChain;
        address adapter;
        bytes32 solanaProgram;
        bytes32 registry;
        uint64 epoch;
        bytes32 proposal;
        bytes32 precommitment;
        uint64 eventNumber;
    }

    struct Registered {
        address uma;
        bytes32 assertionId;
        uint8 claimKind;
        bytes32 claimDigest;
        bytes32 subject;
        uint64 start;
        uint64 deadline;
    }

    struct Disputed {
        bytes32 assertionId;
        bytes32 subject;
        bytes32 disputeId;
    }

    struct Settled {
        bytes32 assertionId;
        bytes32 subject;
        bool accepted;
        bool disputed;
        uint64 settledAt;
    }

    struct Closed {
        bytes32 assertionSetDigest;
        uint64 eventCount;
        bytes32 eventDigest;
        bool accepted;
    }

    struct Reader {
        bytes data;
        uint256 offset;
    }

    function digest(bytes memory domain, bytes memory payload) internal pure returns (bytes32) {
        return sha256(abi.encodePacked(PREFIX, _le32(uint32(domain.length)), domain, payload));
    }

    function decodeEvidenceClaim(bytes memory data)
        internal
        pure
        returns (EvidenceClaim memory claim, bytes32 claimDigest)
    {
        Reader memory r = Reader({data: data, offset: 0});
        claim.context = _context(r);
        claim.evidenceDigest = _hash(r);
        claim.metadataDigest = _hash(r);
        claim.recordId = _recordId(r);
        claim.artifactDigests = _sortedHashes(r, MAX_DIGESTS);
        claim.assessmentDigest = _hash(r);
        claim.provenanceDigests = _sortedHashes(r, MAX_DIGESTS);
        _end(r);
        claimDigest = digest(EVIDENCE_DOMAIN, data);
    }

    function decodeSnapshotClaim(bytes memory data)
        internal
        pure
        returns (SnapshotClaim memory claim, bytes32 claimDigest)
    {
        Reader memory r = Reader({data: data, offset: 0});
        claim.context = _context(r);
        claim.proposal = _hash(r);
        claim.precommitment = _hash(r);
        claim.hasPredecessor = _bool(r);
        if (claim.hasPredecessor) claim.predecessor = _hash(r);
        claim.cutoff = _u64(r);

        uint32 slotCount = _u32(r);
        _require(slotCount >= 1 && slotCount <= MAX_SLOTS);
        claim.slotCount = slotCount;

        bytes32[] memory ids = new bytes32[](uint256(slotCount) * 2);
        bytes32[] memory bindings = new bytes32[](uint256(slotCount) * 2);
        uint256 count;
        uint256 nextOrder;
        for (uint256 i; i < slotCount; ++i) {
            uint256 country = _u8(r);
            uint256 indicator = _u8(r);
            uint256 order = country * MAX_INDICATORS + indicator;
            _require(country < MAX_COUNTRIES && indicator < MAX_INDICATORS && order >= nextOrder);
            nextOrder = order + 1;
            (ids[count], bindings[count]) = _binding(r);
            ++count;
            if (_bool(r)) {
                (ids[count], bindings[count]) = _binding(r);
                ++count;
            }
        }

        bytes32[] memory evidence = _sortedHashes(r, MAX_EVIDENCE_ASSERTIONS);
        _end(r);

        bytes32[] memory bound = new bytes32[](evidence.length);
        for (uint256 i; i < count; ++i) {
            uint256 index = _indexOf(evidence, ids[i]);
            if (bound[index] == bytes32(0)) bound[index] = bindings[i];
            else _require(bound[index] == bindings[i]);
        }
        for (uint256 i; i < bound.length; ++i) {
            _require(bound[i] != bytes32(0));
        }
        claim.evidenceAssertions = evidence;
        claim.bindingIdentities = bound;
        claimDigest = digest(SNAPSHOT_DOMAIN, data);
    }

    function encodeRegistered(RelayHeader memory header, Registered memory e)
        internal
        pure
        returns (bytes memory)
    {
        _require(e.claimKind <= CLAIM_SNAPSHOT);
        _require(uint256(e.start) + LIVENESS == e.deadline);
        return abi.encodePacked(
            _header(header),
            EVENT_REGISTERED,
            e.uma,
            e.assertionId,
            e.claimKind,
            e.claimDigest,
            e.subject,
            _le64(e.start),
            _le64(e.deadline)
        );
    }

    function encodeDisputed(RelayHeader memory header, Disputed memory e)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodePacked(
            _header(header), EVENT_DISPUTED, e.assertionId, e.subject, e.disputeId
        );
    }

    function encodeSettled(RelayHeader memory header, Settled memory e)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodePacked(
            _header(header),
            EVENT_SETTLED,
            e.assertionId,
            e.subject,
            e.accepted,
            e.disputed,
            _le64(e.settledAt)
        );
    }

    function encodeClosed(RelayHeader memory header, Closed memory e)
        internal
        pure
        returns (bytes memory)
    {
        _require(uint256(e.eventCount) + 1 == header.eventNumber);
        return abi.encodePacked(
            _header(header),
            EVENT_CLOSED,
            e.assertionSetDigest,
            _le64(e.eventCount),
            e.eventDigest,
            e.accepted
        );
    }

    function bindingIdentity(
        string memory recordId,
        bytes32 evidenceDigest,
        bytes32 assessmentDigest,
        bytes32 assertionId
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                _le32(uint32(bytes(recordId).length)),
                recordId,
                evidenceDigest,
                assessmentDigest,
                assertionId
            )
        );
    }

    function relayDigest(bytes memory message) internal pure returns (bytes32) {
        return digest(RELAY_DOMAIN, message);
    }

    function assertionSetDigest(bytes32[] memory evidence, bytes32 snapshot)
        internal
        pure
        returns (bytes32)
    {
        _require(evidence.length >= 1 && evidence.length <= MAX_EVIDENCE_ASSERTIONS);
        for (uint256 i; i < evidence.length; ++i) {
            _require(i == 0 || evidence[i - 1] < evidence[i]);
            _require(evidence[i] != snapshot);
        }
        return digest(
            ASSERTIONS_DOMAIN, abi.encodePacked(_le32(uint32(evidence.length)), evidence, snapshot)
        );
    }

    function appendEvent(bytes32 history, bytes memory message) internal pure returns (bytes32) {
        _require(message.length > HEADER_LENGTH && uint8(message[HEADER_LENGTH]) != EVENT_CLOSED);
        return digest(EVENTS_DOMAIN, abi.encodePacked(history, relayDigest(message)));
    }

    function _header(RelayHeader memory h) private pure returns (bytes memory) {
        _require(h.eventNumber > 0);
        return abi.encodePacked(
            _le16(VERSION),
            _le64(h.evmChainId),
            _le16(h.wormholeChain),
            h.adapter,
            h.solanaProgram,
            h.registry,
            _le64(h.epoch),
            h.proposal,
            h.precommitment,
            _le64(h.eventNumber)
        );
    }

    function _context(Reader memory r) private pure returns (ClaimContext memory c) {
        _require(_u16(r) == VERSION);
        c.evmChainId = _u64(r);
        c.adapter = address(bytes20(_word(r, 20)));
        c.solanaProgram = _hash(r);
        c.registry = _hash(r);
        c.epoch = _u64(r);
        c.methodologyManifest = _hash(r);
        c.configurationDigest = _hash(r);
        c.evidencePolicy = _hash(r);
    }

    function _binding(Reader memory r)
        private
        pure
        returns (bytes32 assertionId, bytes32 identity)
    {
        uint256 start = r.offset;
        _recordId(r);
        _hash(r);
        _hash(r);
        assertionId = _hash(r);
        bytes memory data = r.data;
        uint256 length = r.offset - start;
        assembly ("memory-safe") {
            identity := keccak256(add(add(data, 32), start), length)
        }
    }

    function _recordId(Reader memory r) private pure returns (string memory) {
        uint256 length = _u32(r);
        _require(length >= 1 && length <= MAX_RECORD_ID);
        uint256 start = _take(r, length);
        bytes memory out = new bytes(length);
        bytes memory data = r.data;
        for (uint256 i; i < length; ++i) {
            out[i] = data[start + i];
        }
        _require(_validUtf8(out));
        return string(out);
    }

    function _sortedHashes(Reader memory r, uint256 max)
        private
        pure
        returns (bytes32[] memory out)
    {
        uint256 count = _u32(r);
        _require(count >= 1 && count <= max);
        out = new bytes32[](count);
        for (uint256 i; i < count; ++i) {
            out[i] = _hash(r);
            _require(i == 0 || out[i - 1] < out[i]);
        }
    }

    function _indexOf(bytes32[] memory sorted, bytes32 value) private pure returns (uint256) {
        uint256 low;
        uint256 high = sorted.length;
        while (low < high) {
            uint256 mid = (low + high) / 2;
            if (sorted[mid] < value) low = mid + 1;
            else high = mid;
        }
        _require(low < sorted.length && sorted[low] == value);
        return low;
    }

    function _take(Reader memory r, uint256 length) private pure returns (uint256 start) {
        start = r.offset;
        _require(start + length <= r.data.length);
        r.offset = start + length;
    }

    function _word(Reader memory r, uint256 length) private pure returns (bytes32 word) {
        uint256 start = _take(r, length);
        bytes memory data = r.data;
        assembly ("memory-safe") {
            word := mload(add(add(data, 32), start))
        }
        if (length < 32) word &= bytes32(~(type(uint256).max >> (length * 8)));
    }

    function _hash(Reader memory r) private pure returns (bytes32) {
        return _word(r, 32);
    }

    function _u8(Reader memory r) private pure returns (uint8) {
        return uint8(bytes1(_word(r, 1)));
    }

    function _bool(Reader memory r) private pure returns (bool) {
        uint8 value = _u8(r);
        _require(value <= 1);
        return value == 1;
    }

    function _u16(Reader memory r) private pure returns (uint16) {
        return _rev16(uint16(bytes2(_word(r, 2))));
    }

    function _u32(Reader memory r) private pure returns (uint32) {
        return _rev32(uint32(bytes4(_word(r, 4))));
    }

    function _u64(Reader memory r) private pure returns (uint64) {
        return _rev64(uint64(bytes8(_word(r, 8))));
    }

    function _end(Reader memory r) private pure {
        _require(r.offset == r.data.length);
    }

    function _le16(uint16 v) private pure returns (bytes2) {
        return bytes2(_rev16(v));
    }

    function _le32(uint32 v) private pure returns (bytes4) {
        return bytes4(_rev32(v));
    }

    function _le64(uint64 v) private pure returns (bytes8) {
        return bytes8(_rev64(v));
    }

    function _rev16(uint16 v) private pure returns (uint16) {
        return (v >> 8) | (v << 8);
    }

    function _rev32(uint32 v) private pure returns (uint32) {
        v = ((v & 0xFF00FF00) >> 8) | ((v & 0x00FF00FF) << 8);
        return (v >> 16) | (v << 16);
    }

    function _rev64(uint64 v) private pure returns (uint64) {
        v = ((v & 0xFF00FF00FF00FF00) >> 8) | ((v & 0x00FF00FF00FF00FF) << 8);
        v = ((v & 0xFFFF0000FFFF0000) >> 16) | ((v & 0x0000FFFF0000FFFF) << 16);
        return (v >> 32) | (v << 32);
    }

    function _validUtf8(bytes memory s) private pure returns (bool) {
        uint256 i;
        while (i < s.length) {
            uint8 b = uint8(s[i]);
            if (b < 0x80) {
                ++i;
                continue;
            }
            uint256 extra;
            uint8 low = 0x80;
            uint8 high = 0xBF;
            if (b >= 0xC2 && b <= 0xDF) {
                extra = 1;
            } else if (b == 0xE0) {
                (extra, low) = (2, 0xA0);
            } else if ((b >= 0xE1 && b <= 0xEC) || b == 0xEE || b == 0xEF) {
                extra = 2;
            } else if (b == 0xED) {
                (extra, high) = (2, 0x9F);
            } else if (b == 0xF0) {
                (extra, low) = (3, 0x90);
            } else if (b >= 0xF1 && b <= 0xF3) {
                extra = 3;
            } else if (b == 0xF4) {
                (extra, high) = (3, 0x8F);
            } else {
                return false;
            }
            if (i + extra >= s.length) return false;
            uint8 second = uint8(s[i + 1]);
            if (second < low || second > high) return false;
            for (uint256 k = 2; k <= extra; ++k) {
                uint8 next = uint8(s[i + k]);
                if (next < 0x80 || next > 0xBF) return false;
            }
            i += extra + 1;
        }
        return true;
    }

    function _require(bool ok) private pure {
        if (!ok) revert InvalidProtocolEncoding();
    }
}
