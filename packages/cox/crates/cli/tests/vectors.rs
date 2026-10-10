use std::io::Write;
use std::process::{Command, Stdio};

#[test]
fn committed_p1_vectors_match_rust_arithmetic_and_wire_bytes() {
    let output = Command::new(env!("CARGO_BIN_EXE_cox"))
        .args([
            "verify-vectors",
            concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/vectors.json"),
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let result: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(result["arithmeticVectors"], 9);
    assert_eq!(result["priceVectors"], 2);
    assert_eq!(result["snapshotVectors"], 1);
}

#[test]
fn cli_rejects_numeric_amounts_unknown_fields_and_overflow() {
    for input in [
        r#"{"previous":[100,100],"current":["100","100"],"origin":["100","100"],"previousBenchmark":"100000000000000"}"#,
        r#"{"previous":["100","100"],"current":["100","100"],"origin":["100","100"],"previousBenchmark":"100000000000000","multiplier":2}"#,
        r#"{"previous":["18446744073709551616","100"],"current":["100","100"],"origin":["100","100"],"previousBenchmark":"100000000000000"}"#,
    ] {
        let mut child = Command::new(env!("CARGO_BIN_EXE_cox"))
            .arg("reference")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(input.as_bytes())
            .unwrap();
        assert!(!child.wait_with_output().unwrap().status.success());
    }
}

#[test]
fn complete_publication_composes_reference_revaluation_flows_and_ledger() {
    let output = Command::new(env!("CARGO_BIN_EXE_cox"))
        .args([
            "publication",
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../fixtures/publication-input.json"
            ),
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let result: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(
        result["reference"]["relative"],
        serde_json::json!(["120000000000000", "80000000000000"])
    );
    let ledger = &result["ledger"];
    let amount = |field: &str| ledger[field].as_str().unwrap().parse::<u64>().unwrap();
    assert_eq!(amount("vault"), 180);
    assert_eq!(amount("pending"), 0);
    assert_eq!(
        amount("active") + amount("payable") + amount("residual"),
        180
    );
    assert_eq!(result["batch"]["receipts"][0]["outcome"], "Filled");
    assert_eq!(result["batch"]["receipts"][1]["outcome"], "Filled");
}
