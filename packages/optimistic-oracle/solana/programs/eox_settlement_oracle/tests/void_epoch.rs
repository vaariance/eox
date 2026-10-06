mod common;

use {
    common::*,
    eox_settlement_oracle::{constants::*, error::ErrorCode, state::EpochStatus},
};

#[test]
fn an_epoch_without_a_result_is_voided_after_the_deadline() {
    let mut env = TestEnv::new();

    env.set_time(cutoff() + RESULT_DEADLINE);
    assert_error(env.void(YEAR), ErrorCode::DeadlineNotReached);

    env.set_time(cutoff() + RESULT_DEADLINE + 1);
    env.void(YEAR).unwrap();
    assert_eq!(env.epoch(YEAR).status, EpochStatus::Voided);
}

#[test]
fn a_voided_epoch_takes_no_late_result() {
    let mut env = TestEnv::new();
    let vaa = env.post_result(1, &unhex(GOLDEN_PAYLOAD));
    env.set_time(cutoff() + RESULT_DEADLINE + 1);
    env.void(YEAR).unwrap();
    assert_error(env.receive(YEAR, vaa), ErrorCode::InvalidEpochStatus);
}

#[test]
fn a_settled_epoch_cannot_be_voided() {
    let mut env = TestEnv::new();
    env.set_time(cutoff() + 4 * DAY);
    let vaa = env.post_result(1, &unhex(GOLDEN_PAYLOAD));
    env.receive(YEAR, vaa).unwrap();

    env.set_time(cutoff() + RESULT_DEADLINE + 1);
    assert_error(env.void(YEAR), ErrorCode::InvalidEpochStatus);
    assert_eq!(env.epoch(YEAR).status, EpochStatus::Settled);
}
