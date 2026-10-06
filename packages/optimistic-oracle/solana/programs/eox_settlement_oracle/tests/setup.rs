mod common;

use {
    anchor_lang::{error::ErrorCode as AnchorError, prelude::Pubkey},
    common::*,
    eox_settlement_oracle::{constants::*, error::ErrorCode, state::EpochStatus},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

#[test]
fn only_the_upgrade_authority_can_initialize() {
    let mut env = TestEnv::uninitialized();
    let stranger = Keypair::new();
    env.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let (wormhole, emitter) = (env.wormhole, env.emitter);

    assert_error(env.initialize_as(&stranger, wormhole, BASE_CHAIN, emitter), ErrorCode::NotUpgradeAuthority);
    assert!(env.svm.get_account(&config_pda()).is_none());

    let authority = env.authority.insecure_clone();
    env.initialize_as(&authority, wormhole, BASE_CHAIN, emitter).unwrap();
    let config = env.config();
    assert_eq!(config.authority, authority.pubkey());
    assert_eq!(config.wormhole_program, wormhole);
    assert_eq!(config.emitter_chain, BASE_CHAIN);
    assert_eq!(config.emitter_address, emitter);
}

#[test]
fn an_immutable_program_cannot_be_initialized() {
    let mut env = TestEnv::uninitialized();
    set_upgrade_authority(&mut env.svm, &eox_settlement_oracle::id(), None);
    let authority = env.authority.insecure_clone();
    let (wormhole, emitter) = (env.wormhole, env.emitter);
    assert_error(env.initialize_as(&authority, wormhole, BASE_CHAIN, emitter), ErrorCode::NotUpgradeAuthority);
}

#[test]
fn initialize_rejects_program_data_that_is_not_this_programs() {
    let mut env = TestEnv::uninitialized();
    let attacker = Keypair::new();
    env.svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();

    // A genuine program-data account, but at another address and naming the attacker.
    let mut forged = env.svm.get_account(&program_data_pda(&eox_settlement_oracle::id())).unwrap();
    forged.data[12] = 1;
    forged.data[13..45].copy_from_slice(attacker.pubkey().as_ref());
    let forged_address = Pubkey::new_unique();
    env.svm.set_account(forged_address, forged).unwrap();

    let (wormhole, emitter) = (env.wormhole, env.emitter);
    assert_anchor_error(
        env.initialize_with(&attacker, wormhole, BASE_CHAIN, emitter, forged_address),
        AnchorError::ConstraintRaw.into(),
    );
}

#[test]
fn initialize_rejects_an_empty_relay_config() {
    let mut env = TestEnv::uninitialized();
    let authority = env.authority.insecure_clone();
    let (wormhole, emitter) = (env.wormhole, env.emitter);
    for (w, chain, e) in [(Pubkey::default(), BASE_CHAIN, emitter), (wormhole, 0, emitter), (wormhole, BASE_CHAIN, [0; 32])] {
        assert_error(env.initialize_as(&authority, w, chain, e), ErrorCode::InvalidRelayConfig);
    }
}

#[test]
fn the_authority_opens_an_epoch_once() {
    let mut env = TestEnv::new();
    let epoch = env.epoch(YEAR);
    assert_eq!(epoch.year, YEAR);
    assert_eq!(epoch.cutoff, cutoff_timestamp(YEAR));
    assert_eq!(epoch.methodology_image_id, IMAGE_ID);
    assert_eq!(epoch.status, EpochStatus::Open);
    assert_eq!(epoch.result, None);

    assert!(env.open_epoch(YEAR, IMAGE_ID).is_err(), "the epoch account already exists");
}

#[test]
fn only_the_authority_opens_epochs() {
    let mut env = TestEnv::new();
    let stranger = Keypair::new();
    env.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    assert_anchor_error(env.open_epoch_as(&stranger, 2026, IMAGE_ID), AnchorError::ConstraintHasOne.into());
}
