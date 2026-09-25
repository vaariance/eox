use chrono::{Duration, Utc};
use eox_oracle::engine::Wad;
use eox_oracle::services::{cross_check, CrossCheckOutcome};
use eox_oracle::types::Observation;

fn observation(source: &str, value: &str, known_at_offset_secs: i64) -> Observation {
    let base = Utc::now();
    Observation {
        country_iso3: "NGA".to_string(),
        indicator_id: "cpi_core_yoy".to_string(),
        period_start: "2025-01-01".to_string(),
        period_end: "2025-03-31".to_string(),
        value: value.to_string(),
        source_id: source.to_string(),
        vintage: "first".to_string(),
        published_at: base,
        known_at: base + Duration::seconds(known_at_offset_secs),
        recipe_id: Some(1),
        raw_sha256: Some("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string()),
    }
}

fn tolerance() -> Wad {
    Wad::from_decimal_str("0.1").unwrap()
}

#[test]
fn test_lagging_mirror_does_not_trigger_dispute() {
    let mut claimed = observation("nbs", "24.5", 0);
    claimed.known_at += Duration::seconds(3600);
    let stale_mirror = observation("imf", "22.0", 0);

    let outcome = cross_check(&claimed, "24.5", &[stale_mirror], tolerance()).unwrap();

    assert_eq!(outcome, CrossCheckOutcome::NoDispute);
}

#[test]
fn test_mirror_gap_beyond_tolerance_triggers_dispute() {
    let claimed = observation("nbs", "24.5", 0);
    let fresh_mirror = observation("imf", "22.0", 60);
    let close_mirror = observation("oecd", "24.55", 60);

    let outcome = cross_check(&claimed, "24.5", &[close_mirror, fresh_mirror], tolerance()).unwrap();

    assert_eq!(
        outcome,
        CrossCheckOutcome::Dispute {
            mirror_source: "imf".to_string()
        }
    );
}

#[test]
fn test_claim_not_matching_official_artifact_loses() {
    let claimed = observation("nbs", "2.45", 0);

    let outcome = cross_check(&claimed, "24.5", &[], tolerance()).unwrap();

    assert_eq!(outcome, CrossCheckOutcome::ClaimLoses);
}
