use chrono::{Duration, Utc};
use resolution_oracle::oracle::{BondVault, ClaimManager};
use resolution_oracle::types::ClaimStatus;

#[test]
fn test_liveness_settlement_and_dispute_ladder() {
    let now = Utc::now();
    let evidence_root = [1u8; 32];
    let image_id = [2u8; 32];
    let output_hash = [3u8; 32];

    let mut claim = ClaimManager::new_claim(
        "epoch_2025_q1",
        evidence_root,
        image_id,
        output_hash,
        "uri://resolution",
        "proposer_a",
        1000,
        3600,
        now,
    );

    let too_early = now + Duration::seconds(1800);
    let settled = ClaimManager::check_and_settle(&mut claim, too_early).unwrap();
    assert!(!settled);
    assert_eq!(claim.status, ClaimStatus::Proposed);

    let after_liveness = now + Duration::seconds(3601);
    let settled = ClaimManager::check_and_settle(&mut claim, after_liveness).unwrap();
    assert!(settled);
    assert_eq!(claim.status, ClaimStatus::SettledTrue);
}

#[test]
fn test_dispute_auto_reset_and_escalation() {
    let now = Utc::now();
    let mut claim = ClaimManager::new_claim(
        "epoch_2025_q1",
        [1u8; 32],
        [2u8; 32],
        [3u8; 32],
        "uri://resolution",
        "proposer_a",
        1000,
        3600,
        now,
    );

    let status1 = ClaimManager::dispute(&mut claim, 1000).unwrap();
    assert_eq!(status1, ClaimStatus::Requested);
    assert_eq!(claim.dispute_round, 1);

    claim.status = ClaimStatus::Proposed;

    let status2 = ClaimManager::dispute(&mut claim, 1000).unwrap();
    assert_eq!(status2, ClaimStatus::Escalated);
    assert_eq!(claim.dispute_round, 2);
}

#[test]
fn test_pull_payment_bond_vault() {
    let mut vault = BondVault::new(1, 1);

    let cap = vault.max_epoch_tvl(1000);
    assert_eq!(cap, 1000);

    assert!(vault.check_deposit_limit(500, 400, 1000).is_ok());
    assert!(vault.check_deposit_limit(800, 300, 1000).is_err());

    vault.reward_disputer("honest_disputer", 1000, 1000);
    assert_eq!(vault.get_burned_total(), 100);
    assert_eq!(vault.get_balance("honest_disputer"), 1900);

    let withdrawn = vault.withdraw("honest_disputer");
    assert_eq!(withdrawn, 1900);
    assert_eq!(vault.get_balance("honest_disputer"), 0);
}
