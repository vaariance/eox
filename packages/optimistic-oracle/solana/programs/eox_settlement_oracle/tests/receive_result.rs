mod common;

use {
    anchor_lang::{error::ErrorCode as AnchorError, prelude::Pubkey},
    common::*,
    eox_settlement_oracle::{constants::*, error::ErrorCode, state::EpochStatus},
};

#[test]
fn records_the_golden_result_relayed_from_the_adapter() {
    let mut env = TestEnv::new();
    env.set_time(cutoff() + 4 * DAY);
    let vaa = env.post_result(17, &unhex(GOLDEN_PAYLOAD));
    env.receive(YEAR, vaa).unwrap();

    let epoch = env.epoch(YEAR);
    assert_eq!(epoch.status, EpochStatus::Settled);
    let result = epoch.result.unwrap();
    assert_eq!(result.evidence_root, word(0x1111));
    assert_eq!(result.methodology_image_id, IMAGE_ID);
    assert_eq!(result.output_hash, word(0x3333));
    assert_eq!(&result.resolution_uri_hash[..], &unhex(GOLDEN_PAYLOAD)[103..135]);
    assert_eq!(&epoch.assertion_id[..], &unhex(GOLDEN_PAYLOAD)[135..]);
    assert_eq!(epoch.wormhole_sequence, 17);
}

#[test]
fn an_epoch_takes_one_result() {
    let mut env = TestEnv::new();
    env.set_time(cutoff() + 4 * DAY);
    let first = env.post_result(1, &unhex(GOLDEN_PAYLOAD));
    env.receive(YEAR, first).unwrap();

    let again = env.post_result(2, &unhex(GOLDEN_PAYLOAD));
    assert_error(env.receive(YEAR, again), ErrorCode::InvalidEpochStatus);
    assert_eq!(env.epoch(YEAR).wormhole_sequence, 1);
}

#[test]
fn rejects_accounts_the_core_bridge_does_not_own() {
    let mut env = TestEnv::new();
    env.set_time(cutoff() + 4 * DAY);
    let emitter = env.emitter;
    let forged = posted_vaa_data(b"vaa", 1, BASE_CHAIN, emitter, &unhex(GOLDEN_PAYLOAD));
    let vaa = env.post(Pubkey::new_unique(), forged);
    assert_error(env.receive(YEAR, vaa), ErrorCode::NotAVerifiedVaa);
    assert_eq!(env.epoch(YEAR).status, EpochStatus::Open);
}

#[test]
fn rejects_outgoing_messages_the_core_bridge_owns() {
    let mut env = TestEnv::new();
    env.set_time(cutoff() + 4 * DAY);
    let (wormhole, emitter) = (env.wormhole, env.emitter);
    for magic in [b"msg", b"msu"] {
        let vaa = env.post(wormhole, posted_vaa_data(magic, 1, BASE_CHAIN, emitter, &unhex(GOLDEN_PAYLOAD)));
        assert_error(env.receive(YEAR, vaa), ErrorCode::NotAVerifiedVaa);
    }
}

#[test]
fn rejects_results_from_any_other_emitter() {
    let mut env = TestEnv::new();
    env.set_time(cutoff() + 4 * DAY);
    let (wormhole, emitter) = (env.wormhole, env.emitter);
    let mut other = emitter;
    other[31] ^= 1;
    for (chain, address) in [(BASE_CHAIN + 1, emitter), (BASE_CHAIN, other)] {
        let vaa = env.post(wormhole, posted_vaa_data(b"vaa", 1, chain, address, &unhex(GOLDEN_PAYLOAD)));
        assert_error(env.receive(YEAR, vaa), ErrorCode::UnknownEmitter);
    }
}

#[test]
fn rejects_payloads_that_are_not_an_eox_result() {
    let mut env = TestEnv::new();
    env.set_time(cutoff() + 4 * DAY);
    let golden = unhex(GOLDEN_PAYLOAD);
    let mut wrong_version = golden.clone();
    wrong_version[4] = 2;
    for bad in [wrong_version, golden[..golden.len() - 1].to_vec(), b"hello".to_vec()] {
        let vaa = env.post_result(1, &bad);
        assert_error(env.receive(YEAR, vaa), ErrorCode::MalformedPayload);
    }
}

#[test]
fn a_result_must_be_for_this_epoch_and_methodology() {
    let mut env = TestEnv::new();
    env.open_epoch(2026, IMAGE_ID).unwrap();

    // A genuine 2025 result submitted against the 2026 epoch, inside 2026's window.
    env.set_time(cutoff_timestamp(2026) + 4 * DAY);
    let vaa = env.post_result(1, &payload(YEAR, IMAGE_ID));
    assert_error(env.receive(2026, vaa), ErrorCode::WrongEpoch);

    env.set_time(cutoff() + 4 * DAY);
    let vaa = env.post_result(2, &payload(YEAR, word(0x9999)));
    assert_error(env.receive(YEAR, vaa), ErrorCode::WrongMethodology);
}

#[test]
fn results_are_accepted_from_the_cutoff_until_the_deadline() {
    let mut env = TestEnv::new();
    let vaa = env.post_result(1, &unhex(GOLDEN_PAYLOAD));

    env.set_time(cutoff() - 1);
    assert_error(env.receive(YEAR, vaa), ErrorCode::TooEarly);

    env.set_time(cutoff() + RESULT_DEADLINE + 1);
    assert_error(env.receive(YEAR, vaa), ErrorCode::ResultDeadlinePassed);

    env.set_time(cutoff() + RESULT_DEADLINE);
    env.receive(YEAR, vaa).unwrap();
}

#[test]
fn the_epoch_must_be_the_one_named() {
    let mut env = TestEnv::new();
    env.set_time(cutoff() + 4 * DAY);
    let vaa = env.post_result(1, &unhex(GOLDEN_PAYLOAD));
    // No epoch account for 2030.
    assert_anchor_error(env.receive(2030, vaa), AnchorError::AccountNotInitialized.into());
}
