use chrono::Utc;
use eox_engine::types::Observation;
use eox_engine::{build_snapshot, evaluate_methodology, hash_output_bundle, EngineError, Wad};

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
        recipe_id: Some(1),
        raw_sha256: Some("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string()),
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

    let snap_1 = build_snapshot(now, obs_set_1.clone()).unwrap();
    let snap_2 = build_snapshot(now, obs_set_2).unwrap();

    assert_eq!(snap_1.evidence_root, snap_2.evidence_root, "Merkle root R must be bit-identical");

    let bundle_1 = evaluate_methodology(&snap_1, "epoch_2025_q1", "v0.1", [0u8; 32]).unwrap();
    let bundle_2 = evaluate_methodology(&snap_2, "epoch_2025_q1", "v0.1", [0u8; 32]).unwrap();

    let ho_1 = hash_output_bundle(&bundle_1).unwrap();
    let ho_2 = hash_output_bundle(&bundle_2).unwrap();

    assert_eq!(ho_1, ho_2, "Claim hash Ho must be bit-identical regardless of observation order");

    let mut rotated = obs_set_1.clone();
    rotated.rotate_left(3);
    let snap_rotated = build_snapshot(now, rotated).unwrap();
    let bundle_rotated = evaluate_methodology(&snap_rotated, "epoch_2025_q1", "v0.1", [0u8; 32]).unwrap();
    let ho_rotated = hash_output_bundle(&bundle_rotated).unwrap();
    assert_eq!(ho_1, ho_rotated);
}

#[test]
fn test_engine_rejects_duplicate_country_indicator_pair() {
    let now = Utc::now();
    let obs_set = vec![
        sample_obs("NGA", "gdp_real_growth_yoy", "3.2"),
        sample_obs("NGA", "gdp_real_growth_yoy", "4.5"),
        sample_obs("USA", "gdp_real_growth_yoy", "2.1"),
        sample_obs("CHN", "gdp_real_growth_yoy", "5.0"),
        sample_obs("IND", "gdp_real_growth_yoy", "6.8"),
    ];

    let snap = build_snapshot(now, obs_set).unwrap();
    let err = evaluate_methodology(&snap, "epoch_2025_q1", "v0.1", [0u8; 32]).unwrap_err();
    assert!(matches!(err, EngineError::DuplicateObservation { .. }));
}

#[test]
fn test_strict_decimal_parser() {
    assert!(Wad::from_decimal_str("--5").is_err());
    assert!(Wad::from_decimal_str("5.-3").is_err());
    assert!(Wad::from_decimal_str("5.").is_err());
    assert!(Wad::from_decimal_str(".5").is_err());
    assert!(Wad::from_decimal_str("+5").is_err());
    assert!(Wad::from_decimal_str("abc").is_err());

    let val = Wad::from_decimal_str("-5.5").unwrap();
    assert_eq!(val.0, -5_500_000_000_000_000_000);

    let val2 = Wad::from_decimal_str("42").unwrap();
    assert_eq!(val2.0, 42_000_000_000_000_000_000);
}

#[test]
fn test_round_half_even() {
    let w_even = Wad::from_decimal_str("0.0000000000000000005").unwrap();
    assert_eq!(w_even.0, 0);

    let w_odd = Wad::from_decimal_str("0.0000000000000000015").unwrap();
    assert_eq!(w_odd.0, 2);

    let w_tail = Wad::from_decimal_str("0.00000000000000000051").unwrap();
    assert_eq!(w_tail.0, 1);
}

#[test]
fn test_display_min_does_not_panic() {
    let min_wad = Wad(i128::MIN);
    let s = format!("{}", min_wad);
    assert!(s.starts_with("-170141183460469231731"));
}

#[test]
fn test_indicator_polarity() {
    let now = Utc::now();
    let obs_set = vec![
        sample_obs("NGA", "cpi_core_yoy", "30.0"),
        sample_obs("USA", "cpi_core_yoy", "2.0"),
        sample_obs("CHN", "cpi_core_yoy", "5.0"),
        sample_obs("IND", "cpi_core_yoy", "10.0"),
    ];

    let snap = build_snapshot(now, obs_set).unwrap();
    let bundle = evaluate_methodology(&snap, "epoch_2025_q1", "v0.1", [0u8; 32]).unwrap();

    let nga_score = bundle.country_scores.iter().find(|s| s.country_iso3 == "NGA").unwrap();
    let usa_score = bundle.country_scores.iter().find(|s| s.country_iso3 == "USA").unwrap();

    let nga_wad = Wad::from_decimal_str(&nga_score.score).unwrap();
    let usa_wad = Wad::from_decimal_str(&usa_score.score).unwrap();

    assert!(
        nga_wad < usa_wad,
        "Higher inflation must receive a lower (worse) score"
    );
}

#[test]
fn test_missing_country_rejected() {
    let now = Utc::now();
    let obs_set = vec![
        sample_obs("NGA", "gdp_real_growth_yoy", "3.2"),
        sample_obs("USA", "gdp_real_growth_yoy", "2.1"),
        sample_obs("CHN", "gdp_real_growth_yoy", "5.0"),
    ];

    let snap = build_snapshot(now, obs_set).unwrap();
    let err = evaluate_methodology(&snap, "epoch_2025_q1", "v0.1", [0u8; 32]).unwrap_err();
    assert!(matches!(err, EngineError::ObservationNotFound { .. }));
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

    let snap = build_snapshot(now, obs_set).unwrap();
    let bundle = evaluate_methodology(&snap, "epoch_2025_q1", "v0.1", [0u8; 32]).unwrap();

    let mut relative_sum = Wad::ZERO;
    for rel in &bundle.relative_scores {
        let val = Wad::from_decimal_str(&rel.relative_performance).unwrap();
        relative_sum = relative_sum.checked_add(val).unwrap();
    }

    assert!(relative_sum.0.abs() < 1000, "Relative performance must sum to zero");
}

#[test]
fn test_bundle_commits_to_evidence_root_and_methodology_image() {
    let now = Utc::now();
    let obs_set = vec![
        sample_obs("NGA", "gdp_real_growth_yoy", "3.2"),
        sample_obs("USA", "gdp_real_growth_yoy", "2.1"),
        sample_obs("CHN", "gdp_real_growth_yoy", "5.0"),
        sample_obs("IND", "gdp_real_growth_yoy", "6.8"),
    ];

    let snap = build_snapshot(now, obs_set).unwrap();
    let bundle = evaluate_methodology(&snap, "epoch_2025_q1", "v0.1", [1u8; 32]).unwrap();
    let base_hash = hash_output_bundle(&bundle).unwrap();

    let mut tampered_root_bundle = bundle.clone();
    tampered_root_bundle.evidence_root = [0xffu8; 32];
    let tampered_root_hash = hash_output_bundle(&tampered_root_bundle).unwrap();
    assert_ne!(base_hash, tampered_root_hash, "Ho must change when evidence root changes");

    let mut tampered_image_bundle = bundle.clone();
    tampered_image_bundle.methodology_image_id = [0xffu8; 32];
    let tampered_image_hash = hash_output_bundle(&tampered_image_bundle).unwrap();
    assert_ne!(base_hash, tampered_image_hash, "Ho must change when methodology image id changes");
}

fn gdp_set() -> Vec<Observation> {
    vec![
        sample_obs("NGA", "gdp_real_growth_yoy", "3.2"),
        sample_obs("USA", "gdp_real_growth_yoy", "2.1"),
        sample_obs("CHN", "gdp_real_growth_yoy", "5.0"),
        sample_obs("IND", "gdp_real_growth_yoy", "6.8"),
    ]
}

#[test]
fn test_engine_rejects_root_not_matching_observations() {
    let mut snap = build_snapshot(Utc::now(), gdp_set()).unwrap();
    snap.observations[0].value = "9.9".to_string();
    let err = evaluate_methodology(&snap, "epoch_2025_q1", "v0.1", [0u8; 32]).unwrap_err();
    assert_eq!(err, EngineError::EvidenceRootMismatch);
}

#[test]
fn test_engine_computes_root_when_unset() {
    let mut snap = build_snapshot(Utc::now(), gdp_set()).unwrap();
    let expected_root = snap.evidence_root;
    snap.evidence_root = [0u8; 32];
    let bundle = evaluate_methodology(&snap, "epoch_2025_q1", "v0.1", [0u8; 32]).unwrap();
    assert_eq!(bundle.evidence_root, expected_root);
}

#[test]
fn test_missing_indicator_for_one_country_rejected() {
    let mut obs = gdp_set();
    obs.extend([
        sample_obs("NGA", "cpi_core_yoy", "24.5"),
        sample_obs("USA", "cpi_core_yoy", "3.1"),
        sample_obs("CHN", "cpi_core_yoy", "0.5"),
    ]);
    let snap = build_snapshot(Utc::now(), obs).unwrap();
    let err = evaluate_methodology(&snap, "epoch_2025_q1", "v0.1", [0u8; 32]).unwrap_err();
    assert_eq!(
        err,
        EngineError::ObservationNotFound {
            country: "IND".to_string(),
            indicator: "cpi_core_yoy".to_string()
        }
    );
}

#[test]
fn test_unknown_indicator_rejected() {
    let mut obs = gdp_set();
    obs.push(sample_obs("USA", "made_up_index", "1.0"));
    let snap = build_snapshot(Utc::now(), obs).unwrap();
    let err = evaluate_methodology(&snap, "epoch_2025_q1", "v0.1", [0u8; 32]).unwrap_err();
    assert_eq!(err, EngineError::UnknownIndicator("made_up_index".to_string()));
}
