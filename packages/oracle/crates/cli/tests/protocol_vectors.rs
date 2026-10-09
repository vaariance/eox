use eox_oracle_math::protocol::*;
use serde_json::Value;

fn corpus() -> Value { serde_json::from_str(include_str!("../../../fixtures/protocol-v1.json")).unwrap() }
fn hex(bytes: &[u8]) -> String { bytes.iter().map(|b| format!("{b:02x}")).collect() }
#[test]
fn committed_vectors_match_rust_borsh_and_sha256() {
    let c = corpus();
    for v in c["vectors"].as_array().unwrap() {
        let input = v["input"].clone();
        let (bytes, hash) = match v["kind"].as_str().unwrap() {
            "evidence" => { let x: EvidenceClaim = serde_json::from_value(input).unwrap(); (x.encode().unwrap(), x.commitment().unwrap()) },
            "snapshot" => { let x: SnapshotClaim = serde_json::from_value(input).unwrap(); (x.encode().unwrap(), x.commitment().unwrap()) },
            "relay" => { let x: RelayMessage = serde_json::from_value(input).unwrap(); (x.encode().unwrap(), x.commitment().unwrap()) },
            _ => panic!("unknown vector"),
        };
        assert_eq!(hex(&bytes), v["encodedHex"].as_str().unwrap(), "{} bytes", v["name"]);
        assert_eq!(hex(&hash), v["sha256"].as_str().unwrap(), "{} digest", v["name"]);
    }
}
#[test]
fn closure_and_ordered_history_match_shared_vectors() {
    let c=corpus();
    let evidence:Vec<[u8;32]>=serde_json::from_value(c["assertionSet"]["evidence"].clone()).unwrap();
    let snapshot:[u8;32]=serde_json::from_value(c["assertionSet"]["snapshot"].clone()).unwrap();
    assert_eq!(hex(&assertion_set_digest(&evidence,snapshot).unwrap()),c["assertionSet"]["sha256"].as_str().unwrap());
    assert!(assertion_set_digest(&evidence,evidence[0]).is_err());
    let mut previous=[0;32];
    for (i,name) in c["eventHistory"]["vectorNames"].as_array().unwrap().iter().enumerate() {
        let v=c["vectors"].as_array().unwrap().iter().find(|v|v["name"]==*name).unwrap();
        let msg:RelayMessage=serde_json::from_value(v["input"].clone()).unwrap();
        previous=event_history_digest(previous,&msg).unwrap();
        assert_eq!(hex(&previous),c["eventHistory"]["sha256AfterEach"][i].as_str().unwrap());
    }
}
#[test]
fn protocol_rejects_versions_ambiguous_lists_and_incomplete_windows() {
    let c=corpus();
    let mut e:EvidenceClaim=serde_json::from_value(c["vectors"][0]["input"].clone()).unwrap();
    e.context.version=2;assert!(e.encode().is_err());
    e.context.version=1;e.artifact_digests.push(e.artifact_digests[0]);assert!(e.encode().is_err());
    let mut s:SnapshotClaim=serde_json::from_value(c["vectors"][1]["input"].clone()).unwrap();
    s.slots.push(s.slots[0].clone());assert!(s.encode().is_err());
    s.slots[1].indicator=1;assert!(s.encode().is_ok());
    s.slots[1].current.record_id="conflicting-record".into();assert!(s.encode().is_err());
    let mut r:RelayMessage=serde_json::from_value(c["vectors"][3]["input"].clone()).unwrap();
    if let RelayEvent::Registered {ref mut deadline,..}=r.event { *deadline-=1; }
    assert!(r.encode().is_err());
    let mut input=c["vectors"][0]["input"].clone();input["context"]["epoch"]=Value::String("01".into());
    assert!(serde_json::from_value::<EvidenceClaim>(input).is_err());
}
