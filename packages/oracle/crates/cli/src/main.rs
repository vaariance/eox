use eox_oracle_math::*;
use std::{
    error::Error,
    io::{self, Read},
};
fn main() {
    if let Err(e) = run() {
        eprintln!("{e}");
        std::process::exit(1)
    }
}
fn run() -> std::result::Result<(), Box<dyn Error>> {
    let mut args = std::env::args().skip(1);
    let command = args.next().unwrap_or_else(|| "help".into());
    if command == "fixture" {
        println!("{}", serde_json::to_string_pretty(&fixture())?);
        return Ok(());
    }
    if command == "help" {
        println!("eox-oracle fixture | preview [input.json] | evidence-digest [evidence.json]");
        return Ok(());
    }
    let input = if let Some(path) = args.next() {
        std::fs::read_to_string(path)?
    } else {
        let mut s = String::new();
        io::stdin().read_to_string(&mut s)?;
        s
    };
    match command.as_str() {
        "preview" => println!(
            "{}",
            serde_json::to_string_pretty(&preview(&serde_json::from_str::<PreviewInput>(
                &input
            )?)?)?
        ),
        "evidence-digest" => println!(
            "{}",
            serde_json::to_string(&evidence_digest(&serde_json::from_str::<Evidence>(
                &input
            )?)?)?
        ),
        _ => return Err("unknown command".into()),
    };
    Ok(())
}
fn fixture() -> PreviewInput {
    let now = 1_800_000_000;
    let countries = ["US", "JP", "GB", "NG"]
        .iter()
        .enumerate()
        .map(|(country, id)| {
            let mut rules = Vec::new();
            let mut slots = Vec::new();
            for indicator in 0..4 {
                let source = [1; 32];
                let unit = [indicator as u8 + 1; 32];
                let transform = match indicator {
                    1 => Transform::Difference,
                    2 => Transform::FractionalChange,
                    _ => Transform::Identity,
                };
                let normalization = if indicator == 3 {
                    Normalization::Target {
                        target: 0,
                        distance: SCALE,
                    }
                } else {
                    Normalization::Directional {
                        lower: -SCALE,
                        upper: SCALE,
                        direction: 1,
                    }
                };
                let rule = Rule {
                    series_id: [(country * 4 + indicator + 1) as u8; 32],
                    transform,
                    normalization,
                    weight: 1,
                    unit,
                    source,
                    source_authority: 10_000,
                    comparison_period_delta: if indicator == 1 || indicator == 2 {
                        1
                    } else {
                        0
                    },
                    grace_seconds: 30 * 86400,
                    zero_seconds: 90 * 86400,
                };
                let evidence = Evidence {
                    record_id: [(country * 8 + indicator + 1) as u8; 32],
                    series_id: [(country * 4 + indicator + 1) as u8; 32],
                    artifact_digest: artifact_digest(b"EOX synthetic fixture artifact v1\n"),
                    metadata_digest: metadata_digest(&Metadata {
                        country: id.to_string(),
                        indicator: format!("indicator-{indicator}"),
                        revision_id: "fixture-v1".into(),
                        manifest: "artifact.txt".into(),
                        supersedes: None,
                        comparison_record_id: None,
                    })
                    .expect("fixture metadata encodes"),
                    unit,
                    source,
                    value: if indicator == 1 || indicator == 2 {
                        SCALE
                    } else if indicator == 3 {
                        SCALE / 2
                    } else {
                        0
                    },
                    published_at: Some(now - 3600),
                    known_at: Some(now - 3500),
                    recorded_at: now - 3400,
                    period: 2,
                    quality: [10_000; 8],
                };
                let comparison = if indicator == 1 || indicator == 2 {
                    let mut e = evidence.clone();
                    e.record_id = [(country * 8 + indicator + 101) as u8; 32];
                    e.period = 1;
                    e.published_at = Some(now - 86400);
                    Some(e)
                } else {
                    None
                };
                rules.push(rule);
                slots.push(Slot {
                    current: evidence,
                    comparison,
                });
            }
            CountryInput {
                id: id.to_string(),
                rules,
                slots,
                histories: vec![[History::default(), History::default()]; 4],
            }
        })
        .collect();
    PreviewInput {
        evaluation_time: now,
        multiplier: 20,
        countries,
        baseline: None,
    }
}
