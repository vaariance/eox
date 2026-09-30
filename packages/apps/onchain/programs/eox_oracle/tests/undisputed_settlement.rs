mod common;

use {
    common::*,
    eox_oracle::{constants::*, error::ErrorCode, state::EpochStatus},
    solana_signer::Signer,
};

fn proposed_env() -> (TestEnv, anchor_lang::prelude::Pubkey) {
    let mut env = TestEnv::new();
    env.open_epoch(YEAR, BOND).unwrap();
    let proposer = env.proposer.insecure_clone();
    let proposer_token = env.token_account(&proposer.pubkey(), BOND);
    env.set_time(cutoff_timestamp(YEAR) + 3600);
    env.propose(YEAR, &proposer, proposer_token, claim_args([3u8; 32]))
        .unwrap();
    (env, proposer_token)
}

#[test]
fn unchallenged_claim_settles_and_returns_the_bond() {
    let (mut env, proposer_token) = proposed_env();
    let proposer = env.proposer.insecure_clone();

    assert_eq!(env.token_amount(&proposer_token), 0);
    assert_eq!(env.token_amount(&vault_pda()), BOND);
    assert_eq!(env.epoch(YEAR).status, EpochStatus::Proposed);

    let proposed_at = cutoff_timestamp(YEAR) + 3600;
    env.set_time(proposed_at + CHALLENGE_WINDOW - 1);
    assert_error(
        env.settle(YEAR, &proposer.pubkey()),
        ErrorCode::ChallengeWindowOpen,
    );

    env.set_time(proposed_at + CHALLENGE_WINDOW);
    env.settle(YEAR, &proposer.pubkey()).unwrap();

    let epoch = env.epoch(YEAR);
    assert_eq!(epoch.status, EpochStatus::Settled);
    assert_eq!(epoch.claim.unwrap().output_hash, [3u8; 32]);
    assert_eq!(env.balance(&proposer.pubkey()), BOND);

    env.withdraw(&proposer, proposer_token).unwrap();
    assert_eq!(env.token_amount(&proposer_token), BOND);
    assert_eq!(env.token_amount(&vault_pda()), 0);
    assert_eq!(env.balance(&proposer.pubkey()), 0);
}

#[test]
fn a_settled_epoch_cannot_be_settled_or_proposed_again() {
    let (mut env, _) = proposed_env();
    let proposer = env.proposer.insecure_clone();
    env.set_time(cutoff_timestamp(YEAR) + 3600 + CHALLENGE_WINDOW);
    env.settle(YEAR, &proposer.pubkey()).unwrap();

    assert_error(
        env.settle(YEAR, &proposer.pubkey()),
        ErrorCode::InvalidEpochStatus,
    );

    let second_token = env.token_account(&proposer.pubkey(), BOND);
    assert_error(
        env.propose(YEAR, &proposer, second_token, claim_args([9u8; 32])),
        ErrorCode::InvalidEpochStatus,
    );
    assert_eq!(env.epoch(YEAR).claim.unwrap().output_hash, [3u8; 32]);
}

#[test]
fn withdrawing_twice_pays_once() {
    let (mut env, proposer_token) = proposed_env();
    let proposer = env.proposer.insecure_clone();
    env.set_time(cutoff_timestamp(YEAR) + 3600 + CHALLENGE_WINDOW);
    env.settle(YEAR, &proposer.pubkey()).unwrap();

    env.withdraw(&proposer, proposer_token).unwrap();
    assert_error(
        env.withdraw(&proposer, proposer_token),
        ErrorCode::NothingToWithdraw,
    );
    assert_eq!(env.token_amount(&proposer_token), BOND);
}
