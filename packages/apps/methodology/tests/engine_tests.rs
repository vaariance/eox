use chrono::Utc;
use eox_engine::types::Observation;
use eox_engine::{
    build_snapshot, evaluate_methodology, get_methodology_config, hash_output_bundle, EngineError, Wad,
};

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

const COUNTRIES: [&str; 5] = ["CHN", "DEU", "GHA", "NGA", "USA"];
const CORE_INDICATORS: [&str; 5] = [
    "gdp_real_growth_yoy",
    "cpi_core_yoy",
    "unemployment_rate",
    "policy_rate",
    "fiscal_deficit_gdp",
];

fn full_set() -> Vec<Observation> {
    let mut obs = Vec::new();
    for (ci, country) in COUNTRIES.iter().enumerate() {
        for (ii, indicator) in CORE_INDICATORS.iter().enumerate() {
            let value = format!("{}.5", (ci * 3 + ii * 7) % 11 + 1);
            obs.push(sample_obs(country, indicator, &value));
        }
    }
    obs
}

fn min_indicators() -> usize {
    get_methodology_config("v0.1").unwrap().min_indicators_per_country
}

fn evaluate(obs: Vec<Observation>) -> Result<eox_engine::OutputBundle, EngineError> {
    let snap = build_snapshot(Utc::now(), obs).unwrap();
    evaluate_methodology(&snap, "epoch_2025_q1", "v0.1", [0u8; 32])
}

#[test]
fn test_permutation_invariance_bit_identical() {
    let now = Utc::now();
    let obs_set_1 = full_set();
    let mut obs_set_2 = obs_set_1.clone();
    obs_set_2.reverse();

    let snap_1 = build_snapshot(now, obs_set_1.clone()).unwrap();
    let snap_2 = build_snapshot(now, obs_set_2).unwrap();
    assert_eq!(snap_1.evidence_root, snap_2.evidence_root, "Merkle root R must be bit-identical");

    let bundle_1 = evaluate_methodology(&snap_1, "epoch_2025_q1", "v0.1", [0u8; 32]).unwrap();
    let bundle_2 = evaluate_methodology(&snap_2, "epoch_2025_q1", "v0.1", [0u8; 32]).unwrap();
    let ho_1 = hash_output_bundle(&bundle_1).unwrap();
    assert_eq!(ho_1, hash_output_bundle(&bundle_2).unwrap());

    let mut rotated = obs_set_1;
    rotated.rotate_left(7);
    let snap_rotated = build_snapshot(now, rotated).unwrap();
    let bundle_rotated = evaluate_methodology(&snap_rotated, "epoch_2025_q1", "v0.1", [0u8; 32]).unwrap();
    assert_eq!(ho_1, hash_output_bundle(&bundle_rotated).unwrap());
}

#[test]
fn test_engine_rejects_duplicate_country_indicator_pair() {
    let mut obs = full_set();
    obs.push(sample_obs("NGA", "gdp_real_growth_yoy", "4.5"));
    let err = evaluate(obs).unwrap_err();
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
    let mut obs = Vec::new();
    for country in COUNTRIES {
        for indicator in ["gdp_real_growth_yoy", "unemployment_rate", "policy_rate", "fiscal_deficit_gdp"] {
            obs.push(sample_obs(country, indicator, "1.0"));
        }
    }
    for (country, value) in [("NGA", "30.0"), ("USA", "2.0"), ("CHN", "5.0"), ("DEU", "10.0"), ("GHA", "15.0")] {
        obs.push(sample_obs(country, "cpi_core_yoy", value));
    }

    let bundle = evaluate(obs).unwrap();
    let score_of = |c: &str| {
        let s = bundle.country_scores.iter().find(|s| s.country_iso3 == c).unwrap();
        Wad::from_decimal_str(&s.score).unwrap()
    };
    assert!(score_of("NGA") < score_of("USA"), "Higher inflation must receive a lower score");
}

#[test]
fn test_all_countries_scored_when_each_reports_the_minimum() {
    let bundle = evaluate(full_set()).unwrap();
    assert!(bundle.excluded_countries.is_empty());
    assert_eq!(bundle.country_scores.len(), 5);
}

fn without_indicators_beyond(mut obs: Vec<Observation>, country: &str, keep: usize) -> Vec<Observation> {
    let kept: Vec<&str> = CORE_INDICATORS.iter().take(keep).copied().collect();
    obs.retain(|o| o.country_iso3 != country || kept.contains(&o.indicator_id.as_str()));
    obs
}

#[test]
fn test_country_below_minimum_is_excluded() {
    let obs = without_indicators_beyond(full_set(), "GHA", min_indicators() - 1);

    let bundle = evaluate(obs).unwrap();
    assert_eq!(bundle.excluded_countries, vec!["GHA".to_string()]);
    assert!(bundle.country_scores.iter().all(|s| s.country_iso3 != "GHA"));
    assert_eq!(bundle.country_scores.len(), 4);
    assert!(bundle.attribution.iter().all(|t| t.country_iso3 != "GHA"));
}

#[test]
fn test_country_at_the_minimum_is_scored() {
    let obs = without_indicators_beyond(full_set(), "GHA", min_indicators());

    let bundle = evaluate(obs).unwrap();
    assert!(bundle.excluded_countries.is_empty());
    assert_eq!(bundle.country_scores.len(), 5);
}

#[test]
fn test_excluded_country_does_not_move_other_scores() {
    let mut without_gha = full_set();
    without_gha.retain(|o| o.country_iso3 != "GHA");
    let gha_short = without_indicators_beyond(full_set(), "GHA", min_indicators() - 1);

    let a = evaluate(without_gha).unwrap();
    let b = evaluate(gha_short).unwrap();
    assert_eq!(a.country_scores, b.country_scores);
    for rel in &a.relative_scores {
        let other = b.relative_scores.iter().find(|r| r.country_iso3 == rel.country_iso3).unwrap();
        assert_eq!(rel.world_excluding_self, other.world_excluding_self);
    }
}

#[test]
fn test_exclusion_cascades_when_an_indicator_loses_its_second_reporter() {
    let m = min_indicators();
    let value = |ci: usize, ii: usize| format!("{}.5", (ci * 3 + ii * 7) % 11 + 1);
    let mut obs = Vec::new();
    for (ci, country) in ["CHN", "NGA", "USA"].iter().enumerate() {
        for (ii, indicator) in CORE_INDICATORS.iter().take(m).enumerate() {
            obs.push(sample_obs(country, indicator, &value(ci, ii)));
        }
    }
    for (ii, indicator) in CORE_INDICATORS.iter().take(m - 1).enumerate() {
        obs.push(sample_obs("DEU", indicator, &value(4, ii)));
    }
    obs.push(sample_obs("DEU", "pmi", "51.0"));
    for (ii, indicator) in CORE_INDICATORS.iter().take(m - 2).enumerate() {
        obs.push(sample_obs("GHA", indicator, &value(5, ii)));
    }
    obs.push(sample_obs("GHA", "pmi", "49.0"));

    let bundle = evaluate(obs).unwrap();
    assert_eq!(bundle.excluded_countries, vec!["DEU".to_string(), "GHA".to_string()]);
    assert_eq!(bundle.country_scores.len(), 3);
}

#[test]
fn test_indicator_reported_by_one_country_is_ignored() {
    let base = evaluate(full_set()).unwrap();

    let mut with_extra = full_set();
    with_extra.push(sample_obs("USA", "nighttime_lights", "8.0"));
    let extra = evaluate(with_extra).unwrap();

    assert_eq!(base.country_scores, extra.country_scores);
    assert_eq!(base.attribution, extra.attribution);
}

#[test]
fn test_no_country_meeting_the_minimum_is_an_error() {
    let mut obs = Vec::new();
    for country in COUNTRIES {
        for indicator in &CORE_INDICATORS[..min_indicators() - 1] {
            obs.push(sample_obs(country, indicator, "2.5"));
        }
    }
    assert_eq!(evaluate(obs).unwrap_err(), EngineError::InsufficientCoverage);
}

#[test]
fn test_relative_performance_sums_to_zero() {
    let bundle = evaluate(full_set()).unwrap();

    let mut relative_sum = Wad::ZERO;
    for rel in &bundle.relative_scores {
        let val = Wad::from_decimal_str(&rel.relative_performance).unwrap();
        relative_sum = relative_sum.checked_add(val).unwrap();
    }
    assert!(relative_sum.0.abs() < 1000, "Relative performance must sum to zero");
}

#[test]
fn test_bundle_commits_to_evidence_root_methodology_image_and_exclusions() {
    let snap = build_snapshot(Utc::now(), full_set()).unwrap();
    let bundle = evaluate_methodology(&snap, "epoch_2025_q1", "v0.1", [1u8; 32]).unwrap();
    let base_hash = hash_output_bundle(&bundle).unwrap();

    let mut tampered_root = bundle.clone();
    tampered_root.evidence_root = [0xffu8; 32];
    assert_ne!(base_hash, hash_output_bundle(&tampered_root).unwrap());

    let mut tampered_image = bundle.clone();
    tampered_image.methodology_image_id = [0xffu8; 32];
    assert_ne!(base_hash, hash_output_bundle(&tampered_image).unwrap());

    let mut tampered_exclusions = bundle.clone();
    tampered_exclusions.excluded_countries.push("GHA".to_string());
    assert_ne!(base_hash, hash_output_bundle(&tampered_exclusions).unwrap());
}

#[test]
fn test_engine_rejects_root_not_matching_observations() {
    let mut snap = build_snapshot(Utc::now(), full_set()).unwrap();
    snap.observations[0].value = "9.9".to_string();
    let err = evaluate_methodology(&snap, "epoch_2025_q1", "v0.1", [0u8; 32]).unwrap_err();
    assert_eq!(err, EngineError::EvidenceRootMismatch);
}

#[test]
fn test_engine_computes_root_when_unset() {
    let mut snap = build_snapshot(Utc::now(), full_set()).unwrap();
    let expected_root = snap.evidence_root;
    snap.evidence_root = [0u8; 32];
    let bundle = evaluate_methodology(&snap, "epoch_2025_q1", "v0.1", [0u8; 32]).unwrap();
    assert_eq!(bundle.evidence_root, expected_root);
}

#[test]
fn test_unknown_indicator_rejected() {
    let mut obs = full_set();
    obs.push(sample_obs("USA", "made_up_index", "1.0"));
    let err = evaluate(obs).unwrap_err();
    assert_eq!(err, EngineError::UnknownIndicator("made_up_index".to_string()));
}

#[test]
fn test_country_outside_the_universe_rejected() {
    let mut obs = full_set();
    obs.push(sample_obs("IND", "gdp_real_growth_yoy", "6.8"));
    let err = evaluate(obs).unwrap_err();
    assert_eq!(err, EngineError::UnknownCountry("IND".to_string()));
}

#[test]
fn test_world_excludes_the_country_it_is_shown_against() {
    let bundle = evaluate(full_set()).unwrap();

    for rel in &bundle.relative_scores {
        let own_score = Wad::from_decimal_str(
            &bundle
                .country_scores
                .iter()
                .find(|s| s.country_iso3 == rel.country_iso3)
                .unwrap()
                .score,
        )
        .unwrap();
        let others_sum: Wad = bundle
            .country_scores
            .iter()
            .filter(|s| s.country_iso3 != rel.country_iso3)
            .map(|s| Wad::from_decimal_str(&s.score).unwrap())
            .fold(Wad::ZERO, |a, b| a.checked_add(b).unwrap());
        let expected_world =
            others_sum.checked_div(Wad::from_i128(4).unwrap()).unwrap();

        assert_eq!(rel.world_excluding_self, expected_world.to_string());
        assert_eq!(
            rel.relative_performance,
            own_score.checked_sub(expected_world).unwrap().to_string()
        );
    }
}

#[test]
fn test_single_included_country_is_an_error() {
    let mut obs = Vec::new();
    for indicator in CORE_INDICATORS {
        obs.push(sample_obs("USA", indicator, "2.5"));
    }
    assert_eq!(evaluate(obs).unwrap_err(), EngineError::InsufficientCoverage);
}
