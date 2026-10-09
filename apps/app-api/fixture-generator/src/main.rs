use eox_oracle_math::{preview, reference, CountryResult, PreviewInput, Reference};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::error::Error;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn state(id: &str, result: &CountryResult) -> Value {
    json!({
        "country": id,
        "state": result.state.to_string(),
        "confidence": result.confidence.to_string(),
        "saturated": result.saturated,
        "stale": result.stale,
    })
}

fn reference_value(reference: &Reference) -> Value {
    json!({
        "ratio": reference.ratio.to_string(),
        "change": reference.change.to_string(),
        "expressed": reference.expressed.to_string(),
        "confidence": reference.confidence.to_string(),
    })
}

fn scenario(path: &str) -> Result<Value, Box<dyn Error>> {
    let bytes = std::fs::read(path)?;
    let input: PreviewInput = serde_json::from_slice(&bytes)?;
    let output = preview(&input).map_err(|e| format!("{path}: {e}"))?;
    let ids: Vec<&str> = input.countries.iter().map(|c| c.id.as_str()).collect();

    let mut pairs = Vec::new();
    for (a, base) in ids.iter().enumerate() {
        for (b, quote) in ids.iter().enumerate() {
            if a == b {
                continue;
            }
            let pair = reference(
                &output.countries[a],
                &output.countries[b],
                output.baseline[a],
                output.baseline[b],
                input.multiplier,
            )
            .map_err(|e| format!("{path} {base}/{quote}: {e}"))?;
            let mut value = reference_value(&pair);
            value["base"] = json!(base);
            value["quote"] = json!(quote);
            pairs.push(value);
        }
    }

    let slots: Vec<Value> = input
        .countries
        .iter()
        .flat_map(|c| {
            c.slots.iter().enumerate().map(move |(index, slot)| {
                json!({
                    "country": c.id,
                    "indicator": format!("indicator-{index}"),
                    "recordId": hex(&slot.current.record_id),
                    "publishedAt": slot.current.published_at.map(|t| t.to_string()),
                })
            })
        })
        .collect();

    let file = std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("invalid scenario path")?;
    Ok(json!({
        "file": file,
        "sha256": hex(&Sha256::digest(&bytes)),
        "evaluationTime": input.evaluation_time.to_string(),
        "multiplier": input.multiplier,
        "countries": ids,
        "evidenceDigest": hex(&output.evidence_digest),
        "baseline": output.baseline.iter().map(|b| b.to_string()).collect::<Vec<_>>(),
        "states": ids.iter().zip(&output.countries).map(|(id, r)| state(id, r)).collect::<Vec<_>>(),
        "world": {
            "state": output.world.state.to_string(),
            "confidence": output.world.confidence.to_string(),
            "saturated": output.world.saturated,
            "stale": output.world.stale,
        },
        "references": ids.iter().zip(&output.references).map(|(id, r)| {
            let mut value = reference_value(r);
            value["country"] = json!(id);
            value
        }).collect::<Vec<_>>(),
        "pairs": pairs,
        "slots": slots,
    }))
}

fn main() {
    let paths: Vec<String> = std::env::args().skip(1).collect();
    if paths.is_empty() {
        eprintln!("usage: eox-app-api-fixture-generator <scenario.json>...");
        std::process::exit(2);
    }
    let result: Result<Vec<Value>, Box<dyn Error>> = paths.iter().map(|p| scenario(p)).collect();
    match result {
        Ok(scenarios) => println!(
            "{}",
            serde_json::to_string_pretty(&json!({
                "generator": concat!(env!("CARGO_PKG_NAME"), " ", env!("CARGO_PKG_VERSION")),
                "mathCrate": "eox-oracle-math (packages/oracle/crates/math)",
                "scenarios": scenarios,
            }))
            .expect("fixture output serializes")
        ),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
