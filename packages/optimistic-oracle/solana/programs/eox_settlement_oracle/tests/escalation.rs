mod common;

use {
    common::*,
    eox_settlement_oracle::{constants::*, error::ErrorCode, state::{EpochStatus, Resolution}},
};

fn withdraw_everyone(f: &mut Flow) {
    for (wallet, token) in [
        (f.p1.wallet.insecure_clone(), f.p1.token),
        (f.d1.wallet.insecure_clone(), f.d1.token),
        (f.p2.wallet.insecure_clone(), f.p2.token),
        (f.d2.wallet.insecure_clone(), f.d2.token),
    ] {
        let _ = f.env.withdraw(YEAR, &wallet, token);
    }
}

#[test]
fn arbiter_backing_the_proposal_pays_out_both_rounds() {
    let mut f = escalated_flow();
    f.env.resolve(YEAR, Resolution::ProposalWins).unwrap();

    let epoch = f.env.epoch(YEAR);
    assert_eq!(epoch.status, EpochStatus::Settled);
    assert_eq!(epoch.result.unwrap().output_hash, [10u8; 32]);

    withdraw_everyone(&mut f);
    f.env.burn_forfeit(YEAR).unwrap();

    assert_eq!(f.env.token_amount(&f.p1.token), START + BOND * 9 / 10);
    assert_eq!(f.env.token_amount(&f.p2.token), START + BOND * 18 / 10);
    assert_eq!(f.env.token_amount(&f.d1.token), START - BOND);
    assert_eq!(f.env.token_amount(&f.d2.token), START - 2 * BOND);
    assert_eq!(f.env.vault_amount(), 0);
    assert_eq!(f.env.supply(), MINT_SUPPLY - BOND * 3 / 10);
}

#[test]
fn arbiter_backing_the_disputer_pays_out_both_rounds() {
    let mut f = escalated_flow();
    f.env.resolve(YEAR, Resolution::DisputerWins).unwrap();
    assert_eq!(f.env.epoch(YEAR).result.unwrap().output_hash, [30u8; 32]);

    withdraw_everyone(&mut f);
    f.env.burn_forfeit(YEAR).unwrap();

    assert_eq!(f.env.token_amount(&f.d2.token), START + BOND * 18 / 10);
    assert_eq!(f.env.token_amount(&f.d1.token), START + BOND * 9 / 10);
    assert_eq!(f.env.token_amount(&f.p1.token), START - BOND);
    assert_eq!(f.env.token_amount(&f.p2.token), START - 2 * BOND);
    assert_eq!(f.env.vault_amount(), 0);
    assert_eq!(f.env.supply(), MINT_SUPPLY - BOND * 3 / 10);
}

#[test]
fn a_void_ruling_refunds_everyone_and_burns_nothing() {
    let mut f = escalated_flow();
    f.env.resolve(YEAR, Resolution::Void).unwrap();
    assert_eq!(f.env.epoch(YEAR).status, EpochStatus::Voided);

    withdraw_everyone(&mut f);

    for party in [&f.p1, &f.d1, &f.p2, &f.d2] {
        assert_eq!(f.env.token_amount(&party.token), START);
    }
    assert_eq!(f.env.vault_amount(), 0);
    assert_error(f.env.burn_forfeit(YEAR), ErrorCode::NothingToBurn);
    assert_eq!(f.env.supply(), MINT_SUPPLY);
}

#[test]
fn only_the_configured_arbiter_can_rule() {
    let mut f = escalated_flow();
    let impostor = f.env.party(0);
    assert!(f
        .env
        .resolve_as(YEAR, &impostor.wallet, Resolution::DisputerWins)
        .is_err());
    assert_eq!(f.env.epoch(YEAR).status, EpochStatus::Escalated);
}

#[test]
fn the_arbiter_can_only_rule_on_an_escalated_epoch() {
    let mut f = reproposed_flow(10);
    assert_error(
        f.env.resolve(YEAR, Resolution::ProposalWins),
        ErrorCode::InvalidEpochStatus,
    );
}

#[test]
fn a_ruling_after_the_14_day_deadline_is_refused() {
    let mut f = escalated_flow();
    let escalated_at = f.env.epoch(YEAR).escalated_at;

    f.env.set_time(escalated_at + ARBITER_WINDOW + 1);
    assert_error(
        f.env.resolve(YEAR, Resolution::ProposalWins),
        ErrorCode::ArbiterWindowClosed,
    );

    f.env.set_time(escalated_at + ARBITER_WINDOW);
    f.env.resolve(YEAR, Resolution::ProposalWins).unwrap();
}

#[test]
fn a_ruled_epoch_cannot_be_ruled_again() {
    let mut f = escalated_flow();
    f.env.resolve(YEAR, Resolution::ProposalWins).unwrap();
    assert_error(
        f.env.resolve(YEAR, Resolution::DisputerWins),
        ErrorCode::InvalidEpochStatus,
    );
    assert_eq!(f.env.epoch(YEAR).result.unwrap().output_hash, [10u8; 32]);
}

#[test]
fn a_reset_claim_that_is_re_proposed_with_a_new_result_favours_the_first_disputer() {
    let mut f = reproposed_flow(20);
    f.env.set_time(cutoff() + 3 * 3600 + CHALLENGE_WINDOW);
    f.env.settle(YEAR).unwrap();

    withdraw_everyone(&mut f);
    f.env.burn_forfeit(YEAR).unwrap();

    assert_eq!(f.env.token_amount(&f.d1.token), START + BOND * 9 / 10);
    assert_eq!(f.env.token_amount(&f.p1.token), START - BOND);
    assert_eq!(f.env.token_amount(&f.p2.token), START);
    assert_eq!(f.env.vault_amount(), 0);
    assert_eq!(f.env.supply(), MINT_SUPPLY - BOND / 10);
}

#[test]
fn a_reset_claim_re_proposed_with_the_first_result_favours_the_first_proposer() {
    let mut f = reproposed_flow(10);
    f.env.set_time(cutoff() + 3 * 3600 + CHALLENGE_WINDOW);
    f.env.settle(YEAR).unwrap();

    withdraw_everyone(&mut f);
    f.env.burn_forfeit(YEAR).unwrap();

    assert_eq!(f.env.token_amount(&f.p1.token), START + BOND * 9 / 10);
    assert_eq!(f.env.token_amount(&f.d1.token), START - BOND);
    assert_eq!(f.env.token_amount(&f.p2.token), START);
    assert_eq!(f.env.vault_amount(), 0);
}
