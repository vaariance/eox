use chrono::Utc;
use eox_oracle::oracle::BondVault;
use eox_oracle::services::{
    build_snapshot, CrankService, ProposalParams, ProposerService,
};
use eox_oracle::types::{ClaimStatus, Observation};

fn observation(country: &str, value: &str) -> Observation {
    let now = Utc::now();
    Observation {
        country_iso3: country.to_string(),
        indicator_id: "gdp_real_growth_yoy".to_string(),
        period_start: "2025-01-01".to_string(),
        period_end: "2025-03-31".to_string(),
        value: value.to_string(),
        source_id: "official".to_string(),
        vintage: "first".to_string(),
        published_at: now,
        known_at: now,
        recipe_id: Some(1),
        raw_sha256: Some("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string()),
    }
}

fn params(proposer: &str) -> ProposalParams<'_> {
    ProposalParams {
        epoch_id: "epoch_2025_q1",
        version: "v0.1",
        methodology_image_id: [0u8; 32],
        resolution_uri: "uri://claim",
        proposer,
        bond: 1000,
        liveness_seconds: 0,
    }
}

fn snapshot() -> eox_oracle::types::Snapshot {
    build_snapshot(
        Utc::now(),
        vec![
            observation("NGA", "3.2"),
            observation("USA", "2.1"),
            observation("CHN", "5.0"),
            observation("IND", "6.8"),
        ],
    )
    .unwrap()
}

#[test]
fn test_crank_pays_out_deposited_proposer_bond() {
    let mut vault = BondVault::new(1, 1).unwrap();
    let (mut claim, _) =
        ProposerService::create_bonded_proposal(&snapshot(), params("proposer_a"), &mut vault)
            .unwrap();

    let settled = CrankService::advance_claim(&mut claim, &mut vault).unwrap();

    assert!(settled);
    assert_eq!(claim.status, ClaimStatus::SettledTrue);
    assert_eq!(vault.get_deposit("proposer_a"), 1000);
    assert_eq!(vault.get_balance("proposer_a"), 1000);
}

#[test]
fn test_crank_fails_when_bond_was_never_deposited() {
    let mut vault = BondVault::new(1, 1).unwrap();
    let (mut claim, _) = ProposerService::create_proposal(&snapshot(), params("proposer_a")).unwrap();

    assert!(CrankService::advance_claim(&mut claim, &mut vault).is_err());
}
