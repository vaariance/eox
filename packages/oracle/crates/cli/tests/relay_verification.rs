use eox_oracle_math::{protocol::*, relay::*, streaming::StreamingHash};
use serde_json::Value;

fn corpus() -> Value { serde_json::from_str(include_str!("../../../fixtures/protocol-v1.json")).unwrap() }
fn destination(m: &RelayMessage) -> RelayDestination {
    RelayDestination { wormhole_program: [99;32], evm_chain_id: m.header.evm_chain_id,
        wormhole_chain: m.header.wormhole_chain, emitter: [88;32], adapter: m.header.adapter,
        uma: [21;20], program: m.header.solana_program, registry: m.header.registry,
        epoch: m.header.epoch, proposal: m.header.proposal, precommitment: m.header.precommitment,
        consistency_level: 1 }
}
fn posted(m: &RelayMessage, d: &RelayDestination) -> Vec<u8> {
    let payload = m.encode().unwrap();
    let mut bytes = b"vaa".to_vec();
    bytes.extend([1, d.consistency_level]);
    bytes.extend([0;44]);
    bytes.extend(42u64.to_le_bytes());
    bytes.extend(d.wormhole_chain.to_le_bytes());
    bytes.extend(d.emitter);
    bytes.extend((payload.len() as u32).to_le_bytes());
    bytes.extend(payload);
    bytes
}

#[test]
fn all_relay_vectors_decode_and_verify_with_injected_core_owned_accounts() {
    for v in corpus()["vectors"].as_array().unwrap() {
        if v["kind"] != "relay" { continue; }
        let m: RelayMessage = serde_json::from_value(v["input"].clone()).unwrap();
        let d = destination(&m);
        let bytes = posted(&m, &d);
        let verified = verify_posted_relay(d.wormhole_program, &bytes, &d).unwrap();
        assert_eq!(verified.wormhole_sequence, 42);
        assert_eq!(verified.message.commitment().unwrap(), m.commitment().unwrap());
        for end in 0..bytes.len() {
            assert!(verify_posted_relay(d.wormhole_program, &bytes[..end], &d).is_err());
        }
        let mut extra = bytes.clone(); extra.push(0);
        assert!(verify_posted_relay(d.wormhole_program, &extra, &d).is_err());
    }
}

#[test]
fn rejects_foreign_owner_emitter_network_proposal_and_non_vaa_accounts() {
    let m: RelayMessage = serde_json::from_value(corpus()["vectors"][3]["input"].clone()).unwrap();
    let d = destination(&m);
    let bytes = posted(&m, &d);
    assert!(verify_posted_relay([0;32], &bytes, &d).is_err());
    for offset in [0, 3, 4, 57, 59, 91] {
        let mut bad = bytes.clone(); bad[offset] ^= 1;
        assert!(verify_posted_relay(d.wormhole_program, &bad, &d).is_err());
    }
    for magic in [b"msg", b"msu"] {
        let mut bad = bytes.clone(); bad[..3].copy_from_slice(magic);
        assert!(verify_posted_relay(d.wormhole_program, &bad, &d).is_err());
    }
    for mutation in 0..10 {
        let mut bad = destination(&m);
        match mutation {
            0 => bad.evm_chain_id += 1, 1 => bad.wormhole_chain += 1,
            2 => bad.adapter[0] ^= 1, 3 => bad.uma[0] ^= 1,
            4 => bad.program[0] ^= 1, 5 => bad.registry[0] ^= 1,
            6 => bad.epoch += 1, 7 => bad.proposal[0] ^= 1,
            8 => bad.precommitment[0] ^= 1, _ => bad.emitter[0] ^= 1,
        }
        assert!(verify_posted_relay(d.wormhole_program, &bytes, &bad).is_err());
    }
    assert!(decode_relay(b"EOXR\x01").is_err());
    assert!(decode_relay(&vec![0;513]).is_err());
}

#[test]
fn every_claim_and_relay_stream_matches_frozen_vectors() {
    for v in corpus()["vectors"].as_array().unwrap() {
        let (domain, bytes) = match v["kind"].as_str().unwrap() {
            "evidence" => (EVIDENCE_DOMAIN, serde_json::from_value::<EvidenceClaim>(v["input"].clone()).unwrap().encode().unwrap()),
            "snapshot" => (SNAPSHOT_DOMAIN, serde_json::from_value::<SnapshotClaim>(v["input"].clone()).unwrap().encode().unwrap()),
            _ => (RELAY_DOMAIN, serde_json::from_value::<RelayMessage>(v["input"].clone()).unwrap().encode().unwrap()),
        };
        let mut stream = StreamingHash::new(domain).unwrap();
        for part in bytes.chunks(37) { stream.update(part).unwrap(); }
        let hash: String = stream.finish().unwrap().iter().map(|n| format!("{n:02x}")).collect();
        assert_eq!(hash, v["sha256"].as_str().unwrap());
    }
}

#[test]
fn maximum_snapshot_stream_matches_whole_claim_without_changing_wire() {
    let mut s: SnapshotClaim = serde_json::from_value(corpus()["vectors"][1]["input"].clone()).unwrap();
    let template = s.slots[0].clone();
    s.slots = (0..30).flat_map(|country| {
        let template = template.clone();
        (0..32).map(move |indicator| ClaimSlot { country, indicator, ..template.clone() })
    }).collect();
    s.evidence_assertions.clear();
    for (index, slot) in s.slots.iter_mut().enumerate() {
        slot.current.record_id = "c".repeat(256);
        slot.comparison.as_mut().unwrap().record_id = "p".repeat(256);
        for (offset, binding) in [&mut slot.current, slot.comparison.as_mut().unwrap()].into_iter().enumerate() {
            let mut id = [0; 32];
            id[28..].copy_from_slice(&((index * 2 + offset + 1) as u32).to_be_bytes());
            binding.assertion_id = id;
            s.evidence_assertions.push(id);
        }
    }
    let encoded = s.encode().unwrap();
    assert_eq!(s.evidence_assertions.len(), 1920);
    assert!(encoded.len() > 740_000);
    let mut stream = StreamingHash::new(SNAPSHOT_DOMAIN).unwrap();
    for chunk in encoded.chunks(512) { stream.update(chunk).unwrap(); }
    assert_eq!(stream.finish().unwrap(), s.commitment().unwrap());
}
