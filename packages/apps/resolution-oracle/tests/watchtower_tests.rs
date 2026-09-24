use chrono::Utc;
use resolution_oracle::oracle::{BondVault, PanelArbiter, Resolution};
use resolution_oracle::services::{build_snapshot, ProposerService, WatchtowerResult, WatchtowerService};
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
fn test_watchtower_approves_honest_proposal() {
    let now = Utc::now();
    let obs = vec![
        sample_obs("NGA", "gdp_real_growth_yoy", "3.2"),
        sample_obs("USA", "gdp_real_growth_yoy", "2.1"),
        sample_obs("CHN", "gdp_real_growth_yoy", "5.0"),
        sample_obs("IND", "gdp_real_growth_yoy", "6.8"),
    ];

    let snapshot = build_snapshot(now, obs);
    let (mut claim, _) = ProposerService::create_proposal(
        &snapshot,
        "epoch_2025_q1",
        "v0.1",
        [0u8; 32],
        "uri://claim",
        "proposer_honest",
        1000,
        7200,
    )
    .unwrap();

    let mut vault = BondVault::new(1, 1);
    let result = WatchtowerService::verify_and_guard(
        &mut claim,
        &snapshot,
        "v0.1",
        "watchtower_guard",
        1000,
        &mut vault,
    )
    .unwrap();

    assert_eq!(result, WatchtowerResult::Valid);
    assert_eq!(vault.get_balance("watchtower_guard"), 0);
}

#[test]
fn test_watchtower_catches_dishonest_output_hash() {
    let now = Utc::now();
    let obs = vec![
        sample_obs("NGA", "gdp_real_growth_yoy", "3.2"),
        sample_obs("USA", "gdp_real_growth_yoy", "2.1"),
        sample_obs("CHN", "gdp_real_growth_yoy", "5.0"),
        sample_obs("IND", "gdp_real_growth_yoy", "6.8"),
    ];

    let snapshot = build_snapshot(now, obs);
    let (mut claim, _) = ProposerService::create_proposal(
        &snapshot,
        "epoch_2025_q1",
        "v0.1",
        [0u8; 32],
        "uri://claim",
        "proposer_dishonest",
        1000,
        7200,
    )
    .unwrap();

    claim.output_hash = [0xffu8; 32];

    let mut vault = BondVault::new(1, 1);
    let result = WatchtowerService::verify_and_guard(
        &mut claim,
        &snapshot,
        "v0.1",
        "watchtower_guard",
        1000,
        &mut vault,
    )
    .unwrap();

    match result {
        WatchtowerResult::Disputed { reason } => {
            assert!(reason.contains("Output hash Ho mismatch"));
        }
        _ => panic!("Expected watchtower to dispute altered Ho"),
    }

    assert_eq!(vault.get_balance("watchtower_guard"), 1900);
}

#[test]
fn test_panel_arbiter_resolution() {
    let panel = vec![
        "member_1".to_string(),
        "member_2".to_string(),
        "member_3".to_string(),
    ];
    let arbiter = PanelArbiter::new(panel);

    let votes_a = vec![
        ("member_1".to_string(), Resolution::CandidateA),
        ("member_2".to_string(), Resolution::CandidateA),
        ("member_3".to_string(), Resolution::CandidateB),
    ];
    let res_a = arbiter.arbitrate(&votes_a, [1u8; 32], [2u8; 32]).unwrap();
    assert_eq!(res_a, Resolution::CandidateA);

    let votes_void = vec![
        ("member_1".to_string(), Resolution::CandidateA),
        ("member_2".to_string(), Resolution::CandidateB),
        ("member_3".to_string(), Resolution::Void),
    ];
    let res_void = arbiter.arbitrate(&votes_void, [1u8; 32], [2u8; 32]).unwrap();
    assert_eq!(res_void, Resolution::Void);
}
