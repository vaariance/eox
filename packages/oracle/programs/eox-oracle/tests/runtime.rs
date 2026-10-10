//! Run after `cargo build-sbf`: cargo test -p eox-oracle --test runtime -- --ignored --nocapture
//! These tests execute the compiled SBF artifact; no native substitute is used.
use ::eox_oracle::{accounts as a, instruction as i, Registry, Snapshot};
use anchor_lang::AnchorSerialize;
use solana_sdk::{instruction::AccountMeta, pubkey::Pubkey, signature::Signer, system_program};
mod support;
use support::{pda, Harness};

#[test]
#[ignore = "requires compiled SBF artifact"]
fn lifecycle_challenges_retries_rejection_and_history() {
    let mut h = Harness::new(2, 1);
    let s = h.new_snapshot(0);
    h.send(h.operation(s), i::Postcommit {}, false, false);
    h.register(s, 0, [7; 32], true);
    h.register(s, 0, [7; 32], true);
    let before: Snapshot = h.read(s);
    assert_eq!(before.event_count, 1);
    assert_eq!(before.pending, 1);
    h.send(h.operation(s), i::Postcommit {}, false, false);
    h.resolve(s, 0, [7; 32], false);
    h.resolve(s, 0, [7; 32], false);
    let after: Snapshot = h.read(s);
    assert_eq!(after.event_count, 2);
    h.close(s);
    h.send(h.operation(s), i::Postcommit {}, false, true);
    h.calculate(s, 0);
    h.publish(s);
    h.publish(s);
    let first: Snapshot = h.read(s);
    assert_eq!(first.status, 4);
    assert_eq!(first.countries[0].confidence, 950_000);
    assert_eq!(first.countries[0].expressed, 100_000_000);
    h.send(
        a::ReadPair {
            epoch: h.epoch,
            snapshot: s,
        },
        i::ReadPair { base: 0, quote: 1 },
        false,
        true,
    );
    let reused = h.new_snapshot(0);
    h.register(reused, 0, [7; 32], false);
    h.close(reused);
    h.send(h.operation(reused), i::Postcommit {}, false, true);
    h.calculate(reused, 0);
    h.publish(reused);
    let output: Snapshot = h.read(reused);
    assert_eq!(output.countries[0].confidence, 950_000);
    let rejected = h.new_snapshot(1);
    h.register(rejected, 1, [8; 32], true);
    h.resolve(rejected, 1, [8; 32], true);
    h.send(h.operation(rejected), i::Postcommit {}, false, false);
    h.close(rejected);
    let corrected = h.new_snapshot(2);
    h.close(rejected);
    let registry: Registry = h.read(h.registry);
    assert_eq!(registry.active, corrected);
    assert_eq!(registry.latest, reused);
    h.close(corrected);
    h.send(h.operation(corrected), i::Postcommit {}, false, true);
    h.calculate(corrected, 2);
    h.publish(corrected);
    let old: Snapshot = h.read(s);
    assert_eq!(old.postcommitment, first.postcommitment);
    assert_eq!(old.countries[0].confidence, first.countries[0].confidence);
    h.resolve(s, 0, [7; 32], true);
    let registry: Registry = h.read(h.registry);
    assert!(registry.paused);
    println!(
        "lifecycle maximum tx={} bytes compute={}",
        h.max_bytes, h.max_compute
    );
}

#[test]
#[ignore = "requires compiled SBF artifact"]
fn maximum_universe_executes_bounded_transactions() {
    let mut h = Harness::new(30, 32);
    let s = h.new_snapshot(0);
    h.close(s);
    h.send(h.operation(s), i::Postcommit {}, false, true);
    h.calculate(s, 0);
    h.publish(s);
    let result: Snapshot = h.read(s);
    assert_eq!(result.countries.len(), 30);
    assert!(result
        .countries
        .iter()
        .all(|c| c.complete && c.expressed == 100_000_000));
    println!(
        "maximum universe tx={} bytes compute={}",
        h.max_bytes, h.max_compute
    );
    assert!(h.max_compute <= 200_000);
}

#[test]
#[ignore = "requires compiled SBF artifact"]
fn frozen_evidence_competing_proposals_and_interrupted_calculation() {
    let mut h = Harness::new(2, 1);
    let s = h.new_snapshot(0);
    let registry: Registry = h.read(h.registry);
    let competing = pda(&[
        b"snapshot",
        h.epoch.as_ref(),
        &registry.next_sequence.to_le_bytes(),
    ]);
    h.send(
        a::CreateSnapshot {
            registry: h.registry,
            epoch: h.epoch,
            snapshot: competing,
            authority: h.authority.pubkey(),
            system_program: system_program::ID,
        },
        i::CreateSnapshot {
            sequence: registry.next_sequence,
            cutoff: 100_000,
        },
        false,
        false,
    );
    h.send(
        a::UploadSlot {
            registry: h.registry,
            epoch: h.epoch,
            snapshot: s,
            rules: h.rules(0, 0),
            page_account: h.page(s, 0, 0),
            authority: h.authority.pubkey(),
            system_program: system_program::ID,
        },
        i::UploadSlot {
            country: 0,
            page: 0,
            index: 0,
            slot: h.slot(0, 0, 1).try_to_vec().unwrap(),
        },
        false,
        false,
    );
    // Time alone cannot accept evidence, nor can an adapter close with a false digest.
    h.time(100_060);
    h.send(h.operation(s), i::Postcommit {}, false, false);
    h.send(
        a::AdapterSnapshot {
            registry: h.registry,
            snapshot: s,
            adapter: h.adapter.pubkey(),
        },
        i::CloseWindow {
            count: 0,
            digest: [99; 32],
        },
        true,
        false,
    );
    h.close(s);
    h.send(h.operation(s), i::Postcommit {}, false, true);
    let slot = h.slot(0, 0, 0);
    h.send_remaining(
        h.page_operation(s, 0, 0),
        i::CalculatePage {
            country: 0,
            page: 0,
        },
        vec![
            AccountMeta::new_readonly(h.history(&slot.current), false),
            AccountMeta::new_readonly(h.history(slot.comparison.as_ref().unwrap()), false),
        ],
        false,
        true,
    );
    h.send(
        a::Publish {
            registry: h.registry,
            epoch: h.epoch,
            snapshot: s,
            authority: h.authority.pubkey(),
        },
        i::Publish {},
        false,
        false,
    );
    let registry: Registry = h.read(h.registry);
    assert_eq!(registry.latest, Pubkey::default());
    let partial: Snapshot = h.read(s);
    assert!(partial.countries[0].complete);
    assert!(!partial.countries[1].complete);
    h.time(partial.evaluation_time + 3601);
    h.send(h.operation(s), i::Expire {}, false, true);
    let expired: Snapshot = h.read(s);
    assert_eq!(expired.status, 7);
    let registry: Registry = h.read(h.registry);
    assert_eq!(registry.latest, Pubkey::default());
    assert_eq!(registry.active, Pubkey::default());
}
