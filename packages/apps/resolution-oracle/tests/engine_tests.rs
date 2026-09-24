use chrono::Utc;
use resolution_oracle::engine::{evaluate_methodology, hash_output_bundle, Wad};
use resolution_oracle::services::build_snapshot;
use resolution_oracle::types::Observation;

fn sample_obs(country: &str, indicator: &str, val: &str) -> Observation {
    let now = Utc::now();
    Observation {
        country_iso3: country.to_string(),
        indicator_id: indicator.to_string(),
        period_start: "2025-01-01".to_string(),
        period_end: "2025-03-31".to_string(),
        value: val.to_string(),
        source_id: "official".to_string(),
        vintage: "first".to_string(),
        published_at: now,
        known_at: now,
        recipe_id: None,
        raw_sha256: None,
    }
}

#[test]
fn test_fixed_point_arithmetic() {
    let a = Wad::from_decimal_str("3.5").unwrap();
    let b = Wad::from_decimal_str("2.0").unwrap();

    let sum = a.checked_add(b).unwrap();
    assert_eq!(sum, Wad::from_decimal_str("5.5").unwrap());

    let diff = a.checked_sub(b).unwrap();
    assert_eq!(diff, Wad::from_decimal_str("1.5").unwrap());

    let prod = a.checked_mul(b).unwrap();
    assert_eq!(prod, Wad::from_decimal_str("7.0").unwrap());

    let quot = a.checked_div(b).unwrap();
    assert_eq!(quot, Wad::from_decimal_str("1.75").unwrap());

    let four = Wad::from_decimal_str("4.0").unwrap();
    let sqrt_four = four.isqrt().unwrap();
    assert_eq!(sqrt_four, Wad::from_decimal_str("2.0").unwrap());
}

#[test]
fn test_permutation_invariance_bit_identical() {
    let now = Utc::now();
    let obs_set_1 = vec![
        sample_obs("NGA", "gdp_real_growth_yoy", "3.2"),
        sample_obs("USA", "gdp_real_growth_yoy", "2.1"),
        sample_obs("CHN", "gdp_real_growth_yoy", "5.0"),
        sample_obs("IND", "gdp_real_growth_yoy", "6.8"),
        sample_obs("NGA", "cpi_core_yoy", "24.5"),
        sample_obs("USA", "cpi_core_yoy", "3.1"),
        sample_obs("CHN", "cpi_core_yoy", "0.5"),
        sample_obs("IND", "cpi_core_yoy", "4.8"),
    ];

    let mut obs_set_2 = obs_set_1.clone();
    obs_set_2.reverse();

    let snap_1 = build_snapshot(now, obs_set_1);
    let snap_2 = build_snapshot(now, obs_set_2);

    assert_eq!(snap_1.evidence_root, snap_2.evidence_root, "Merkle root R must be bit-identical");

    let bundle_1 = evaluate_methodology(&snap_1, "epoch_2025_q1", "v0.1").unwrap();
    let bundle_2 = evaluate_methodology(&snap_2, "epoch_2025_q1", "v0.1").unwrap();

    let ho_1 = hash_output_bundle(&bundle_1).unwrap();
    let ho_2 = hash_output_bundle(&bundle_2).unwrap();

    assert_eq!(ho_1, ho_2, "Claim hash Ho must be bit-identical regardless of observation order");
}

#[test]
fn test_relative_performance_sums_to_zero() {
    let now = Utc::now();
    let obs_set = vec![
        sample_obs("NGA", "gdp_real_growth_yoy", "3.2"),
        sample_obs("USA", "gdp_real_growth_yoy", "2.1"),
        sample_obs("CHN", "gdp_real_growth_yoy", "5.0"),
        sample_obs("IND", "gdp_real_growth_yoy", "6.8"),
    ];

    let snap = build_snapshot(now, obs_set);
    let bundle = evaluate_methodology(&snap, "epoch_2025_q1", "v0.1").unwrap();

    let mut relative_sum = Wad::ZERO;
    for rel in &bundle.relative_scores {
        let val = Wad::from_decimal_str(&rel.relative_performance).unwrap();
        relative_sum = relative_sum.checked_add(val).unwrap();
    }

    assert!(relative_sum.0.abs() < 1000, "Relative performance must sum to zero");
}
