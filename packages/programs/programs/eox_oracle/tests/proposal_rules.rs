mod common;

use {
    common::*,
    eox_oracle::{constants::*, error::ErrorCode, state::EpochStatus},
    solana_signer::Signer,
};

fn open_env() -> TestEnv {
    let mut env = TestEnv::new();
    env.open_epoch(YEAR, BOND).unwrap();
    env
}

#[test]
fn epoch_cutoff_is_31_july_of_the_following_year() {
    let env = open_env();
    let epoch = env.epoch(YEAR);
    assert_eq!(epoch.cutoff, 1_785_456_000);
    assert_eq!(epoch.bond, BOND);
    assert_eq!(epoch.status, EpochStatus::Requested);
}

#[test]
fn proposing_before_the_cutoff_is_too_early() {
    let mut env = open_env();
    let proposer = env.proposer.insecure_clone();
    let token = env.token_account(&proposer.pubkey(), BOND);

    env.set_time(cutoff_timestamp(YEAR) - 1);
    assert_error(
        env.propose(YEAR, &proposer, token, claim_args([3u8; 32])),
        ErrorCode::TooEarly,
    );
    assert_eq!(env.token_amount(&token), BOND);
}

#[test]
fn proposing_after_the_48_hour_window_is_rejected() {
    let mut env = open_env();
    let proposer = env.proposer.insecure_clone();
    let token = env.token_account(&proposer.pubkey(), BOND);

    env.set_time(cutoff_timestamp(YEAR) + PROPOSAL_WINDOW + 1);
    assert_error(
        env.propose(YEAR, &proposer, token, claim_args([3u8; 32])),
        ErrorCode::ProposalWindowClosed,
    );

    env.set_time(cutoff_timestamp(YEAR) + PROPOSAL_WINDOW);
    env.propose(YEAR, &proposer, token, claim_args([3u8; 32]))
        .unwrap();
}

#[test]
fn only_a_permitted_proposer_may_propose() {
    let mut env = open_env();
    let outsider = env.funded_wallet();
    let token = env.token_account(&outsider.pubkey(), BOND);

    env.set_time(cutoff_timestamp(YEAR) + 3600);
    assert_error(
        env.propose(YEAR, &outsider, token, claim_args([3u8; 32])),
        ErrorCode::NotAProposer,
    );
}

#[test]
fn only_the_authority_may_open_an_epoch() {
    let mut env = TestEnv::new();
    let impostor = env.funded_wallet();
    env.authority = impostor;
    assert!(env.open_epoch(YEAR, BOND).is_err());
}

#[test]
fn an_epoch_cannot_be_opened_with_a_zero_bond() {
    let mut env = TestEnv::new();
    assert_error(env.open_epoch(YEAR, 0), ErrorCode::ZeroBond);
}
