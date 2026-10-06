mod common;

use {
    common::*,
    eox_settlement_oracle::{constants::*, error::ErrorCode, state::EpochStatus},
};

#[test]
fn epoch_cutoff_is_31_july_of_the_following_year() {
    let f = open_flow();
    let epoch = f.env.epoch(YEAR);
    assert_eq!(epoch.cutoff, 1_785_456_000);
    assert_eq!(epoch.bond, BOND);
    assert_eq!(epoch.status, EpochStatus::Requested);
}

#[test]
fn proposing_before_the_cutoff_is_too_early() {
    let mut f = open_flow();
    f.env.set_time(cutoff() - 1);
    assert_error(f.env.propose(YEAR, &f.p1, body(3)), ErrorCode::TooEarly);
    assert_eq!(f.env.token_amount(&f.p1.token), START);
}

#[test]
fn proposing_after_the_48_hour_window_is_rejected() {
    let mut f = open_flow();
    f.env.set_time(cutoff() + PROPOSAL_WINDOW + 1);
    assert_error(
        f.env.propose(YEAR, &f.p1, body(3)),
        ErrorCode::ProposalWindowClosed,
    );

    f.env.set_time(cutoff() + PROPOSAL_WINDOW);
    f.env.propose(YEAR, &f.p1, body(3)).unwrap();
}

#[test]
fn only_a_permitted_proposer_may_propose() {
    let mut f = open_flow();
    f.env.set_time(cutoff() + 3600);
    assert_error(
        f.env.propose(YEAR, &f.d1, body(3)),
        ErrorCode::NotAProposer,
    );
}

#[test]
fn a_second_claim_cannot_be_proposed_while_one_stands() {
    let mut f = proposed_flow(3);
    assert_error(
        f.env.propose(YEAR, &f.p2, body(9)),
        ErrorCode::InvalidEpochStatus,
    );
}

#[test]
fn the_first_bond_is_the_epoch_bond_and_the_second_is_double() {
    let f = reproposed_flow(10);
    let epoch = f.env.epoch(YEAR);
    assert_eq!(epoch.proposals[0].unwrap().bond, BOND);
    assert_eq!(epoch.proposals[1].unwrap().bond, 2 * BOND);
    assert_eq!(f.env.vault_amount(), BOND + BOND + 2 * BOND);
}

#[test]
fn re_proposing_after_a_reset_must_happen_within_48_hours() {
    let mut f = reset_flow();
    let reset_at = f.env.epoch(YEAR).reset_at;

    f.env.set_time(reset_at + PROPOSAL_WINDOW + 1);
    assert_error(
        f.env.propose(YEAR, &f.p2, body(10)),
        ErrorCode::ProposalWindowClosed,
    );

    f.env.set_time(reset_at + PROPOSAL_WINDOW);
    f.env.propose(YEAR, &f.p2, body(10)).unwrap();
}

#[test]
fn only_the_authority_may_open_an_epoch() {
    let mut env = TestEnv::new();
    env.authority = env.party(0).wallet;
    assert!(env.open_epoch(YEAR, BOND).is_err());
}

#[test]
fn an_epoch_cannot_be_opened_with_a_zero_bond() {
    let mut env = TestEnv::new();
    assert_error(env.open_epoch(YEAR, 0), ErrorCode::ZeroBond);
}
