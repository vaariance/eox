//! The proposer, watchtower and crank against mocked evidence and a mocked chain. These pin
//! what each bot decides and sends; the programs' own LiteSVM tests cover what they accept.

mod common;

use anchor_lang::{prelude::Pubkey, AnchorDeserialize, Discriminator};
use common::*;
use eox_oracle::bots::{self, build_claim, CrankAction, ProposeOutcome, Verdict};
use eox_oracle::chain::{bond_account, instructions};
use eox_oracle::merkle::hash_observation;
use eox_settlement_oracle::{
    constants::{ARBITER_WINDOW, CHALLENGE_WINDOW, PROPOSAL_WINDOW},
    instruction,
    merkle::{is_member, leaf_hash},
    state::{ClaimBody, Epoch, EpochStatus, Proposal},
    Grounds,
};
use solana_keypair::Keypair;
use solana_signer::Signer;

fn open_epoch() -> Epoch {
    Epoch::new(YEAR, cutoff(), BOND, IMAGE_ID, 254)
}

/// The claim an honest proposer posts for the mocked snapshot.
fn honest_claim() -> ClaimBody {
    build_claim(&mock_snapshot(), &open_epoch(), VERSION, URI)
        .unwrap()
        .body
}

fn proposed_epoch(body: ClaimBody, proposed_at: i64) -> Epoch {
    let mut epoch = open_epoch();
    epoch.status = EpochStatus::Proposed;
    epoch.round = 1;
    epoch.proposals[0] = Some(Proposal {
        body,
        proposer: Pubkey::new_unique(),
        bond: BOND,
        proposed_at,
    });
    epoch
}

/// A chain holding a live round-1 claim built from `published`, proposed at the cutoff.
fn chain_with_claim_from(
    published: &eox_oracle::types::Snapshot,
    now: i64,
) -> (MockChain, ClaimBody) {
    let body = build_claim(published, &open_epoch(), VERSION, URI)
        .unwrap()
        .body;
    let mut chain = MockChain::new(now);
    chain.set_epoch(&proposed_epoch(body, cutoff()));
    (chain, body)
}

fn sent_dispute(chain: &MockChain) -> instruction::Dispute {
    assert_eq!(
        chain.sent.len(),
        1,
        "expected exactly one dispute to be sent"
    );
    let data = &chain.sent[0].0.data;
    let prefix = instruction::Dispute::DISCRIMINATOR.len();
    assert_eq!(&data[..prefix], instruction::Dispute::DISCRIMINATOR);
    instruction::Dispute::deserialize(&mut &data[prefix..]).unwrap()
}

fn watch(
    chain: &mut MockChain,
    ours: &eox_oracle::types::Snapshot,
    published: Option<&eox_oracle::types::Snapshot>,
) -> Option<Verdict> {
    bots::watch(chain, YEAR, &Keypair::new(), ours, published, VERSION, URI).unwrap()
}

// ---------------------------------------------------------------- proposer

#[test]
fn mocked_snapshot_is_valid_evidence_for_the_epoch() {
    let snapshot = mock_snapshot();
    assert_eq!(snapshot.observations.len(), 25);
    let bundle = build_claim(&snapshot, &open_epoch(), VERSION, URI)
        .unwrap()
        .bundle;
    assert_eq!(bundle.epoch_id, "epoch_2025");
    assert_eq!(bundle.country_scores.len(), 5);
    assert!(bundle.excluded_countries.is_empty());
}

#[test]
fn claims_are_deterministic() {
    assert_eq!(honest_claim(), honest_claim());
}

#[test]
fn proposes_inside_the_window_with_the_bond_account() {
    let mut chain = MockChain::with_open_epoch(cutoff() + 60);
    let proposer = Keypair::new();

    let outcome =
        bots::propose(&mut chain, YEAR, &proposer, &mock_snapshot(), VERSION, URI).unwrap();

    let body = honest_claim();
    assert_eq!(outcome, ProposeOutcome::Proposed(body));
    let token = bond_account(&proposer.pubkey(), &chain.bond_mint);
    assert_eq!(
        chain.sent,
        vec![(
            instructions::propose(YEAR, proposer.pubkey(), token, body),
            proposer.pubkey()
        )]
    );
}

#[test]
fn proposal_window_bounds_match_the_program() {
    for (now, accepting) in [
        (cutoff() - 1, false),
        (cutoff(), true),
        (cutoff() + PROPOSAL_WINDOW, true),
        (cutoff() + PROPOSAL_WINDOW + 1, false),
    ] {
        let mut chain = MockChain::with_open_epoch(now);
        let outcome = bots::propose(
            &mut chain,
            YEAR,
            &Keypair::new(),
            &mock_snapshot(),
            VERSION,
            URI,
        )
        .unwrap();
        assert_eq!(
            matches!(outcome, ProposeOutcome::Proposed(_)),
            accepting,
            "at cutoff{:+}",
            now - cutoff()
        );
        assert_eq!(chain.sent.len(), usize::from(accepting));
    }
}

#[test]
fn proposes_again_after_a_reset_until_its_window_closes() {
    let reset_at = cutoff() + 10 * 3600;
    let mut epoch = open_epoch();
    epoch.status = EpochStatus::Reset;
    epoch.round = 1;
    epoch.reset_at = reset_at;

    for (now, accepting) in [
        (reset_at + PROPOSAL_WINDOW, true),
        (reset_at + PROPOSAL_WINDOW + 1, false),
    ] {
        let mut chain = MockChain::new(now);
        chain.set_epoch(&epoch);
        let outcome = bots::propose(
            &mut chain,
            YEAR,
            &Keypair::new(),
            &mock_snapshot(),
            VERSION,
            URI,
        )
        .unwrap();
        assert_eq!(matches!(outcome, ProposeOutcome::Proposed(_)), accepting);
    }
}

#[test]
fn does_not_propose_without_an_open_epoch() {
    let mut chain = MockChain::new(cutoff());
    let outcome = bots::propose(
        &mut chain,
        YEAR,
        &Keypair::new(),
        &mock_snapshot(),
        VERSION,
        URI,
    )
    .unwrap();
    assert_eq!(outcome, ProposeOutcome::NotAccepting);

    let mut chain = MockChain::new(cutoff() + 60);
    chain.set_epoch(&proposed_epoch(honest_claim(), cutoff()));
    let outcome = bots::propose(
        &mut chain,
        YEAR,
        &Keypair::new(),
        &mock_snapshot(),
        VERSION,
        URI,
    )
    .unwrap();
    assert_eq!(outcome, ProposeOutcome::NotAccepting);
    assert!(chain.sent.is_empty());
}

// ---------------------------------------------------------------- watchtower

#[test]
fn agrees_with_an_honest_claim_and_sends_nothing() {
    let (mut chain, _) = chain_with_claim_from(&mock_snapshot(), cutoff() + 60);
    assert_eq!(
        watch(&mut chain, &mock_snapshot(), None),
        Some(Verdict::Agrees)
    );
    assert!(chain.sent.is_empty());
}

#[test]
fn disputes_the_computation_when_the_evidence_matches_but_the_output_does_not() {
    let mut chain = MockChain::new(cutoff() + 60);
    let mut body = honest_claim();
    body.output_hash = [9u8; 32];
    chain.set_epoch(&proposed_epoch(body, cutoff()));

    let verdict = watch(&mut chain, &mock_snapshot(), None).unwrap();

    assert!(matches!(
        verdict,
        Verdict::Dispute {
            grounds: Grounds::Computation,
            ..
        }
    ));
    let dispute = sent_dispute(&chain);
    assert_eq!(dispute.grounds, Grounds::Computation);
    assert_eq!(dispute.candidate, honest_claim());
}

#[test]
fn names_a_wrong_observation_with_a_proof_the_program_accepts() {
    let mut tampered = full_observations();
    tampered[7].value = "99.5".to_string();
    let published = with_observations(tampered.clone());
    let (mut chain, claim) = chain_with_claim_from(&published, cutoff() + 60);

    watch(&mut chain, &mock_snapshot(), Some(&published)).unwrap();

    let Grounds::WrongObservation {
        observation,
        path,
        correction,
    } = sent_dispute(&chain).grounds
    else {
        panic!("expected a wrong observation");
    };
    assert!(is_member(
        &claim.evidence_root,
        &leaf_hash(&observation),
        &path
    ));
    assert_eq!(
        leaf_hash(&observation),
        hash_observation(&tampered[7]).unwrap()
    );
    assert_eq!(
        correction,
        Some(hash_observation(&full_observations()[7]).unwrap())
    );
}

#[test]
fn an_observation_we_do_not_have_is_wrong_with_no_correction() {
    let mut padded = full_observations();
    padded.remove(3);
    let ours = with_observations(padded);
    let (mut chain, claim) = chain_with_claim_from(&mock_snapshot(), cutoff() + 60);

    watch(&mut chain, &ours, Some(&mock_snapshot())).unwrap();

    let Grounds::WrongObservation {
        observation,
        path,
        correction,
    } = sent_dispute(&chain).grounds
    else {
        panic!("expected a wrong observation");
    };
    assert!(is_member(
        &claim.evidence_root,
        &leaf_hash(&observation),
        &path
    ));
    assert_eq!(correction, None);
}

#[test]
fn names_an_observation_the_claim_left_out() {
    let mut short = full_observations();
    let dropped = short.remove(12);
    let published = with_observations(short);
    let (mut chain, _) = chain_with_claim_from(&published, cutoff() + 60);

    watch(&mut chain, &mock_snapshot(), Some(&published)).unwrap();

    assert_eq!(
        sent_dispute(&chain).grounds,
        Grounds::MissingObservation {
            correction: hash_observation(&dropped).unwrap()
        }
    );
}

#[test]
fn cannot_verify_different_evidence_without_the_published_snapshot() {
    let mut tampered = full_observations();
    tampered[0].value = "42.5".to_string();
    let (mut chain, _) = chain_with_claim_from(&with_observations(tampered), cutoff() + 60);

    let verdict = watch(&mut chain, &mock_snapshot(), None).unwrap();

    assert!(matches!(verdict, Verdict::CannotVerify(_)));
    assert!(chain.sent.is_empty());
}

#[test]
fn cannot_verify_a_published_snapshot_that_does_not_match_the_claim() {
    let mut tampered = full_observations();
    tampered[0].value = "42.5".to_string();
    let (mut chain, _) = chain_with_claim_from(&with_observations(tampered), cutoff() + 60);
    let mut other = full_observations();
    other[1].value = "43.5".to_string();

    let verdict = watch(
        &mut chain,
        &mock_snapshot(),
        Some(&with_observations(other)),
    )
    .unwrap();

    assert!(matches!(verdict, Verdict::CannotVerify(_)));
    assert!(chain.sent.is_empty());
}

#[test]
fn stops_watching_when_the_challenge_window_closes() {
    let mut tampered = full_observations();
    tampered[0].value = "42.5".to_string();
    let published = with_observations(tampered);

    let (mut chain, _) = chain_with_claim_from(&published, cutoff() + CHALLENGE_WINDOW - 1);
    assert!(matches!(
        watch(&mut chain, &mock_snapshot(), Some(&published)),
        Some(Verdict::Dispute { .. })
    ));

    let (mut chain, _) = chain_with_claim_from(&published, cutoff() + CHALLENGE_WINDOW);
    assert_eq!(watch(&mut chain, &mock_snapshot(), Some(&published)), None);
    assert!(chain.sent.is_empty());
}

#[test]
fn watches_nothing_before_a_claim_or_after_settlement() {
    let mut chain = MockChain::with_open_epoch(cutoff() + 60);
    assert_eq!(watch(&mut chain, &mock_snapshot(), None), None);

    let mut settled = proposed_epoch(honest_claim(), cutoff());
    settled.status = EpochStatus::Settled;
    let mut chain = MockChain::new(cutoff() + 60);
    chain.set_epoch(&settled);
    assert_eq!(watch(&mut chain, &mock_snapshot(), None), None);
    assert!(chain.sent.is_empty());
}

// ---------------------------------------------------------------- crank

fn crank_at(epoch: &Epoch, now: i64) -> (Option<CrankAction>, MockChain) {
    let mut chain = MockChain::new(now);
    chain.set_epoch(epoch);
    let action = bots::crank(&mut chain, YEAR, &Keypair::new()).unwrap();
    (action, chain)
}

#[test]
fn settles_an_unchallenged_claim_once_the_window_closes() {
    let epoch = proposed_epoch(honest_claim(), cutoff());

    let (action, chain) = crank_at(&epoch, cutoff() + CHALLENGE_WINDOW - 1);
    assert_eq!(action, None);
    assert!(chain.sent.is_empty());

    let (action, chain) = crank_at(&epoch, cutoff() + CHALLENGE_WINDOW);
    assert_eq!(action, Some(CrankAction::Settle));
    assert_eq!(chain.sent[0].0, instructions::settle(YEAR));
}

#[test]
fn voids_an_epoch_nobody_proposed_for() {
    let epoch = open_epoch();
    assert_eq!(crank_at(&epoch, cutoff() + PROPOSAL_WINDOW).0, None);

    let (action, chain) = crank_at(&epoch, cutoff() + PROPOSAL_WINDOW + 1);
    assert_eq!(action, Some(CrankAction::Void));
    assert_eq!(chain.sent[0].0, instructions::void_epoch(YEAR));
}

#[test]
fn voids_a_reset_epoch_with_no_new_claim() {
    let mut epoch = open_epoch();
    epoch.status = EpochStatus::Reset;
    epoch.reset_at = cutoff() + 3600;
    assert_eq!(crank_at(&epoch, epoch.reset_at + PROPOSAL_WINDOW).0, None);
    assert_eq!(
        crank_at(&epoch, epoch.reset_at + PROPOSAL_WINDOW + 1).0,
        Some(CrankAction::Void)
    );
}

#[test]
fn voids_an_escalation_the_panel_did_not_rule_on() {
    let mut epoch = open_epoch();
    epoch.status = EpochStatus::Escalated;
    epoch.escalated_at = cutoff() + 5 * 86_400;
    assert_eq!(
        crank_at(&epoch, epoch.escalated_at + ARBITER_WINDOW).0,
        None
    );
    assert_eq!(
        crank_at(&epoch, epoch.escalated_at + ARBITER_WINDOW + 1).0,
        Some(CrankAction::Void)
    );
}

#[test]
fn burns_the_forfeited_share_once_the_epoch_is_over() {
    for status in [EpochStatus::Settled, EpochStatus::Voided] {
        let mut epoch = open_epoch();
        epoch.status = status;
        assert_eq!(
            crank_at(&epoch, cutoff()).0,
            None,
            "{status:?} with nothing owed"
        );

        epoch.burn_owed = BOND / 10;
        let (action, chain) = crank_at(&epoch, cutoff());
        assert_eq!(action, Some(CrankAction::BurnForfeit));
        assert_eq!(
            chain.sent[0].0,
            instructions::burn_forfeit(YEAR, chain.bond_mint)
        );
    }
}

#[test]
fn cranks_nothing_for_an_epoch_that_does_not_exist() {
    let mut chain = MockChain::new(cutoff() + 365 * 86_400);
    assert_eq!(
        bots::crank(&mut chain, YEAR, &Keypair::new()).unwrap(),
        None
    );
    assert!(chain.sent.is_empty());
}

// ---------------------------------------------------------------- full round

/// One epoch from the bots' side: an honest proposal goes unchallenged and settles, with
/// the watchtower agreeing along the way. A tampered proposal is challenged instead.
#[test]
fn honest_epoch_settles_and_a_tampered_one_is_challenged() {
    let snapshot = mock_snapshot();
    let mut chain = MockChain::with_open_epoch(cutoff() + 60);
    let ProposeOutcome::Proposed(body) =
        bots::propose(&mut chain, YEAR, &Keypair::new(), &snapshot, VERSION, URI).unwrap()
    else {
        panic!("expected a proposal");
    };
    chain.set_epoch(&proposed_epoch(body, chain.now));
    chain.sent.clear();

    chain.now += 3600;
    assert_eq!(
        watch(&mut chain, &snapshot, Some(&snapshot)),
        Some(Verdict::Agrees)
    );
    chain.now = chain.stored_epoch().proposals[0].unwrap().proposed_at + CHALLENGE_WINDOW;
    assert_eq!(
        bots::crank(&mut chain, YEAR, &Keypair::new()).unwrap(),
        Some(CrankAction::Settle)
    );

    let mut tampered = full_observations();
    tampered[20].value = "0.5".to_string();
    let published = with_observations(tampered);
    let (mut chain, _) = chain_with_claim_from(&published, cutoff() + 3600);
    assert!(matches!(
        watch(&mut chain, &snapshot, Some(&published)),
        Some(Verdict::Dispute {
            grounds: Grounds::WrongObservation { .. },
            ..
        })
    ));
}
