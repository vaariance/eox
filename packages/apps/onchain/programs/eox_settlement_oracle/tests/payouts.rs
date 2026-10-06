mod common;

use {
    common::*,
    eox_settlement_oracle::{constants::*, error::ErrorCode, state::Resolution},
};

#[test]
fn burning_before_the_epoch_resolves_is_refused() {
    let mut f = escalated_flow();
    assert_error(f.env.burn_forfeit(YEAR), ErrorCode::EpochNotResolved);
}

#[test]
fn the_burn_can_only_happen_once() {
    let mut f = escalated_flow();
    f.env.resolve(YEAR, Resolution::ProposalWins).unwrap();

    f.env.burn_forfeit(YEAR).unwrap();
    assert_error(f.env.burn_forfeit(YEAR), ErrorCode::NothingToBurn);
    assert_eq!(f.env.supply(), MINT_SUPPLY - BOND * 3 / 10);
}

#[test]
fn everyone_owed_money_can_be_paid_from_the_vault_in_full() {
    let mut f = escalated_flow();
    f.env.resolve(YEAR, Resolution::ProposalWins).unwrap();

    let owed: u64 = f.env.epoch(YEAR).payouts.iter().map(|p| p.amount).sum();
    let burn = f.env.epoch(YEAR).burn_owed;
    assert_eq!(owed + burn, f.env.vault_amount());
}

#[test]
fn a_frozen_winner_account_blocks_only_that_withdrawal() {
    let mut f = escalated_flow();
    f.env.resolve(YEAR, Resolution::ProposalWins).unwrap();

    f.env.freeze(&f.p2.token);
    assert!(f.env.withdraw(YEAR, &f.p2.wallet, f.p2.token).is_err());
    assert_eq!(f.env.owed_to(YEAR, &f.p2.key()), 3 * BOND + BOND * 8 / 10);

    f.env.withdraw(YEAR, &f.p1.wallet, f.p1.token).unwrap();
    f.env.burn_forfeit(YEAR).unwrap();
    assert_eq!(f.env.token_amount(&f.p1.token), START + BOND * 9 / 10);

    let clean = f.env.token_account(&f.p2.key(), 0);
    f.env.withdraw(YEAR, &f.p2.wallet, clean).unwrap();
    assert_eq!(f.env.token_amount(&clean), 3 * BOND + BOND * 8 / 10);
    assert_eq!(f.env.vault_amount(), 0);
}

#[test]
fn a_frozen_account_cannot_stop_the_oracle_settling() {
    let mut f = proposed_flow(3);
    f.env.freeze(&f.p1.token);

    f.env.set_time(cutoff() + 3600 + CHALLENGE_WINDOW);
    f.env.settle(YEAR).unwrap();

    let clean = f.env.token_account(&f.p1.key(), 0);
    f.env.withdraw(YEAR, &f.p1.wallet, clean).unwrap();
    assert_eq!(f.env.token_amount(&clean), BOND);
}
