mod common;

use {
    anchor_lang::{error::ErrorCode as AnchorError, prelude::Pubkey},
    common::*,
    eox_settlement_oracle::{constants::*, error::ErrorCode},
    solana_signer::Signer,
};

const HOUR: i64 = 3600;

#[test]
fn only_the_upgrade_authority_can_initialize() {
    let mut env = TestEnv::uninitialized();
    let stranger = env.party(0).wallet;
    let proposers = vec![env.proposer.key()];

    assert_error(env.initialize_as(&stranger, proposers.clone()), ErrorCode::NotUpgradeAuthority);
    assert!(env.svm.get_account(&config_pda()).is_none());

    let authority = env.authority.insecure_clone();
    env.initialize_as(&authority, proposers).unwrap();
    assert_eq!(env.config().authority, authority.pubkey());
}

#[test]
fn an_immutable_program_cannot_be_initialized() {
    let mut env = TestEnv::uninitialized();
    set_upgrade_authority(&mut env.svm, &eox_settlement_oracle::id(), None);
    let authority = env.authority.insecure_clone();
    assert_error(env.initialize_as(&authority, vec![]), ErrorCode::NotUpgradeAuthority);
}

#[test]
fn initialize_rejects_program_data_that_is_not_this_programs() {
    let mut env = TestEnv::uninitialized();
    let attacker = env.party(0).wallet;

    // A genuine program-data account, but at another address and naming the attacker.
    let mut forged = env.svm.get_account(&program_data_pda(&eox_settlement_oracle::id())).unwrap();
    forged.data[12] = 1;
    forged.data[13..45].copy_from_slice(attacker.pubkey().as_ref());
    let forged_address = Pubkey::new_unique();
    env.svm.set_account(forged_address, forged).unwrap();

    assert_anchor_error(
        env.initialize_with(&attacker, vec![attacker.pubkey()], forged_address),
        AnchorError::ConstraintRaw.into(),
    );
}

#[test]
fn initialize_rejects_a_proposer_listed_twice() {
    let mut env = TestEnv::uninitialized();
    let authority = env.authority.insecure_clone();
    let proposer = env.proposer.key();
    assert_error(
        env.initialize_as(&authority, vec![proposer, proposer]),
        ErrorCode::DuplicateProposer,
    );
}

#[test]
fn an_added_proposer_can_propose() {
    let mut env = TestEnv::new();
    env.open_epoch(YEAR, BOND).unwrap();
    let newcomer = env.party(START);

    env.set_time(cutoff() + HOUR);
    assert_error(env.propose(YEAR, &newcomer, body(10)), ErrorCode::NotAProposer);

    env.add_proposer(newcomer.key()).unwrap();
    env.propose(YEAR, &newcomer, body(10)).unwrap();
    assert_eq!(env.config().proposers.len(), 3);
}

#[test]
fn a_removed_proposer_can_no_longer_propose() {
    let mut env = TestEnv::new();
    env.open_epoch(YEAR, BOND).unwrap();
    let removed = Party { wallet: env.proposer.wallet.insecure_clone(), token: env.proposer.token };

    env.remove_proposer(removed.key()).unwrap();
    env.set_time(cutoff() + HOUR);
    assert_error(env.propose(YEAR, &removed, body(10)), ErrorCode::NotAProposer);
    assert_eq!(env.config().proposers, vec![env.second_proposer.key()]);
}

#[test]
fn removing_a_proposer_does_not_touch_a_bond_they_already_posted() {
    let mut f = proposed_flow(10);
    f.env.remove_proposer(f.p1.key()).unwrap();

    f.env.set_time(cutoff() + HOUR + CHALLENGE_WINDOW);
    f.env.settle(YEAR).unwrap();
    f.env.withdraw(YEAR, &f.p1.wallet, f.p1.token).unwrap();
    assert_eq!(f.env.token_amount(&f.p1.token), START);
}

#[test]
fn only_the_authority_manages_proposers() {
    let mut env = TestEnv::new();
    let stranger = env.party(0).wallet;
    assert_anchor_error(
        env.add_proposer_as(&stranger, stranger.pubkey()),
        AnchorError::ConstraintHasOne.into(),
    );
}

#[test]
fn the_list_rejects_duplicates_and_stops_at_its_limit() {
    let mut env = TestEnv::new();
    let listed = env.proposer.key();
    assert_error(env.add_proposer(listed), ErrorCode::DuplicateProposer);

    while env.config().proposers.len() < MAX_PROPOSERS {
        env.add_proposer(Pubkey::new_unique()).unwrap();
    }
    assert_error(env.add_proposer(Pubkey::new_unique()), ErrorCode::TooManyProposers);
}

#[test]
fn removing_someone_not_listed_fails() {
    let mut env = TestEnv::new();
    assert_error(env.remove_proposer(Pubkey::new_unique()), ErrorCode::NotAProposer);
}
