mod common;

use {
    common::*,
    eox_settlement_oracle::{constants::*, error::ErrorCode, state::EpochStatus},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

#[test]
fn unchallenged_claim_settles_and_returns_the_bond() {
    let mut f = proposed_flow(3);
    let proposed_at = cutoff() + 3600;

    assert_eq!(f.env.token_amount(&f.p1.token), START - BOND);
    assert_eq!(f.env.vault_amount(), BOND);
    assert_eq!(f.env.epoch(YEAR).status, EpochStatus::Proposed);

    f.env.set_time(proposed_at + CHALLENGE_WINDOW - 1);
    assert_error(f.env.settle(YEAR), ErrorCode::ChallengeWindowOpen);

    f.env.set_time(proposed_at + CHALLENGE_WINDOW);
    f.env.settle(YEAR).unwrap();

    let epoch = f.env.epoch(YEAR);
    assert_eq!(epoch.status, EpochStatus::Settled);
    assert_eq!(epoch.result.unwrap().output_hash, [3u8; 32]);
    assert_eq!(f.env.owed_to(YEAR, &f.p1.key()), BOND);

    f.env.withdraw(YEAR, &f.p1.wallet, f.p1.token).unwrap();
    assert_eq!(f.env.token_amount(&f.p1.token), START);
    assert_eq!(f.env.vault_amount(), 0);
}

#[test]
fn a_payout_can_go_to_any_token_account_the_owner_chooses() {
    let mut f = proposed_flow(3);
    f.env.set_time(cutoff() + 3600 + CHALLENGE_WINDOW);
    f.env.settle(YEAR).unwrap();

    let elsewhere = f.env.token_account(&Keypair::new().pubkey(), 0);
    f.env.withdraw(YEAR, &f.p1.wallet, elsewhere).unwrap();
    assert_eq!(f.env.token_amount(&elsewhere), BOND);
    assert_eq!(f.env.token_amount(&f.p1.token), START - BOND);
}

#[test]
fn a_settled_epoch_cannot_be_settled_or_proposed_again() {
    let mut f = proposed_flow(3);
    f.env.set_time(cutoff() + 3600 + CHALLENGE_WINDOW);
    f.env.settle(YEAR).unwrap();

    assert_error(f.env.settle(YEAR), ErrorCode::InvalidEpochStatus);
    assert_error(
        f.env.propose(YEAR, &f.p2, body(9)),
        ErrorCode::InvalidEpochStatus,
    );
    assert_eq!(f.env.epoch(YEAR).result.unwrap().output_hash, [3u8; 32]);
}

#[test]
fn withdrawing_twice_pays_once() {
    let mut f = proposed_flow(3);
    f.env.set_time(cutoff() + 3600 + CHALLENGE_WINDOW);
    f.env.settle(YEAR).unwrap();

    f.env.withdraw(YEAR, &f.p1.wallet, f.p1.token).unwrap();
    assert_error(
        f.env.withdraw(YEAR, &f.p1.wallet, f.p1.token),
        ErrorCode::NothingToWithdraw,
    );
    assert_eq!(f.env.token_amount(&f.p1.token), START);
}

#[test]
fn nobody_can_withdraw_another_partys_payout() {
    let mut f = proposed_flow(3);
    f.env.set_time(cutoff() + 3600 + CHALLENGE_WINDOW);
    f.env.settle(YEAR).unwrap();

    let thief = f.env.party(0);
    assert_error(
        f.env.withdraw(YEAR, &thief.wallet, thief.token),
        ErrorCode::NothingToWithdraw,
    );
    assert_eq!(f.env.owed_to(YEAR, &f.p1.key()), BOND);
}

#[test]
fn nothing_can_be_withdrawn_before_the_epoch_resolves() {
    let mut f = proposed_flow(3);
    assert_error(
        f.env.withdraw(YEAR, &f.p1.wallet, f.p1.token),
        ErrorCode::EpochNotResolved,
    );
}
