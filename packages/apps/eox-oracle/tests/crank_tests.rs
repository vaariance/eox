use eox_oracle::oracle::BondVault;
use eox_oracle::services::{
    build_snapshot, CrankService, ProposalParams, ProposerService,
};
use eox_oracle::types::ClaimStatus;

mod common;

fn params(proposer: &str) -> ProposalParams<'_> {
    ProposalParams {
        epoch_id: "epoch_2025",
        version: "v0.1",
        methodology_image_id: [0u8; 32],
        resolution_uri: "uri://claim",
        proposer,
        bond: 1000,
        liveness_seconds: 0,
    }
}

fn snapshot() -> eox_oracle::types::Snapshot {
    build_snapshot(common::cutoff(), common::full_observations()).unwrap()
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
