mod common;

use {
    common::*,
    eox_settlement_oracle::{constants::*, error::ErrorCode, state::EpochStatus},
};

#[test]
fn an_epoch_nobody_proposes_for_voids_after_the_proposal_window() {
    let mut f = open_flow();

    f.env.set_time(cutoff() + PROPOSAL_WINDOW);
    assert_error(f.env.void(YEAR), ErrorCode::DeadlineNotReached);

    f.env.set_time(cutoff() + PROPOSAL_WINDOW + 1);
    f.env.void(YEAR).unwrap();
    assert_eq!(f.env.epoch(YEAR).status, EpochStatus::Voided);

    assert_error(
        f.env.propose(YEAR, &f.p1, body(3)),
        ErrorCode::InvalidEpochStatus,
    );
}

#[test]
fn a_reset_claim_nobody_re_proposes_voids_and_refunds_both_bonds() {
    let mut f = reset_flow();
    let reset_at = f.env.epoch(YEAR).reset_at;

    f.env.set_time(reset_at + PROPOSAL_WINDOW);
    assert_error(f.env.void(YEAR), ErrorCode::DeadlineNotReached);

    f.env.set_time(reset_at + PROPOSAL_WINDOW + 1);
    f.env.void(YEAR).unwrap();

    f.env.withdraw(YEAR, &f.p1.wallet, f.p1.token).unwrap();
    f.env.withdraw(YEAR, &f.d1.wallet, f.d1.token).unwrap();
    assert_eq!(f.env.token_amount(&f.p1.token), START);
    assert_eq!(f.env.token_amount(&f.d1.token), START);
    assert_eq!(f.env.vault_amount(), 0);
}

#[test]
fn a_silent_arbiter_lets_anyone_void_and_refund_all_four_bonds() {
    let mut f = escalated_flow();
    let escalated_at = f.env.epoch(YEAR).escalated_at;

    f.env.set_time(escalated_at + ARBITER_WINDOW);
    assert_error(f.env.void(YEAR), ErrorCode::DeadlineNotReached);

    f.env.set_time(escalated_at + ARBITER_WINDOW + 1);
    f.env.void(YEAR).unwrap();

    for party in [&f.p1, &f.d1, &f.p2, &f.d2] {
        f.env.withdraw(YEAR, &party.wallet, party.token).unwrap();
        assert_eq!(f.env.token_amount(&party.token), START);
    }
    assert_eq!(f.env.vault_amount(), 0);
}

#[test]
fn a_standing_claim_or_a_settled_epoch_cannot_be_voided() {
    let mut f = proposed_flow(3);
    f.env.set_time(cutoff() + 30 * 24 * 3600);
    assert_error(f.env.void(YEAR), ErrorCode::InvalidEpochStatus);

    f.env.settle(YEAR).unwrap();
    assert_error(f.env.void(YEAR), ErrorCode::InvalidEpochStatus);
}
