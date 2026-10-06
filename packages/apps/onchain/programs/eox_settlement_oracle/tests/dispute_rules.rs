mod common;

use {
    common::*,
    eox_settlement_oracle::{constants::*, error::ErrorCode, state::EpochStatus},
};

#[test]
fn the_first_dispute_resets_the_claim_instead_of_escalating() {
    let f = reset_flow();
    let epoch = f.env.epoch(YEAR);

    assert_eq!(epoch.status, EpochStatus::Reset);
    assert_eq!(epoch.reset_at, cutoff() + 2 * 3600);
    assert_eq!(epoch.disputes[0].unwrap().candidate.output_hash, [20u8; 32]);
    assert_eq!(f.env.vault_amount(), 2 * BOND);
    assert_eq!(f.env.token_amount(&f.d1.token), START - BOND);
}

#[test]
fn the_second_dispute_escalates_and_both_sides_post_double() {
    let f = escalated_flow();
    let epoch = f.env.epoch(YEAR);

    assert_eq!(epoch.status, EpochStatus::Escalated);
    assert_eq!(epoch.disputes[1].unwrap().bond, 2 * BOND);
    assert_eq!(f.env.token_amount(&f.d2.token), START - 2 * BOND);
    assert_eq!(f.env.vault_amount(), 6 * BOND);
}

#[test]
fn nothing_more_can_be_proposed_or_disputed_once_escalated() {
    let mut f = escalated_flow();
    assert_error(
        f.env.propose(YEAR, &f.p1, body(7)),
        ErrorCode::InvalidEpochStatus,
    );
    assert_error(
        f.env.dispute(YEAR, &f.d1, body(8)),
        ErrorCode::InvalidEpochStatus,
    );
}

#[test]
fn a_disputed_claim_cannot_be_settled() {
    let mut f = reset_flow();
    f.env.set_time(cutoff() + 10 * 24 * 3600);
    assert_error(f.env.settle(YEAR), ErrorCode::InvalidEpochStatus);
}

#[test]
fn a_dispute_needs_a_claim_to_dispute() {
    let mut f = open_flow();
    f.env.set_time(cutoff() + 3600);
    assert_error(
        f.env.dispute(YEAR, &f.d1, body(20)),
        ErrorCode::InvalidEpochStatus,
    );
}

#[test]
fn a_dispute_must_land_inside_the_challenge_window() {
    let mut f = proposed_flow(10);
    let proposed_at = cutoff() + 3600;

    f.env.set_time(proposed_at + CHALLENGE_WINDOW);
    assert_error(
        f.env.dispute(YEAR, &f.d1, body(20)),
        ErrorCode::ChallengeWindowClosed,
    );

    f.env.set_time(proposed_at + CHALLENGE_WINDOW - 1);
    f.env.dispute(YEAR, &f.d1, body(20)).unwrap();
}

#[test]
fn a_dispute_must_offer_a_different_result() {
    let mut f = proposed_flow(10);
    assert_error(
        f.env.dispute(YEAR, &f.d1, body(10)),
        ErrorCode::NoDisagreement,
    );
    assert_eq!(f.env.vault_amount(), BOND);
}

#[test]
fn a_disputer_who_cannot_cover_the_bond_is_rejected() {
    let mut f = proposed_flow(10);
    let poor = f.env.party(BOND - 1);
    assert!(f.env.dispute(YEAR, &poor, body(20)).is_err());
    assert_eq!(f.env.epoch(YEAR).status, EpochStatus::Proposed);
    assert_eq!(f.env.vault_amount(), BOND);
}
