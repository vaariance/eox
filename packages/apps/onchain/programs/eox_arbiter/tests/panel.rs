mod common;

use {
    common::*,
    eox_arbiter::{constants::*, error::ErrorCode},
    eox_settlement_oracle::{constants::ARBITER_WINDOW, state::{EpochStatus, Resolution::*}},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

#[test]
fn every_member_posts_a_bond_into_the_panel_vault() {
    let mut p = Panel::new();
    for member in 0..PANEL_SIZE {
        p.post_bond(member).unwrap();
        assert_eq!(p.token_amount(&p.members[member].token), 0);
    }
    assert_eq!(p.vault_amount(), 3 * MEMBER_BOND);
    assert_error(p.post_bond(0), ErrorCode::AlreadyBonded);
}

#[test]
fn only_a_panel_member_can_post_a_bond() {
    let mut p = Panel::new();
    let outsider = p.party(MEMBER_BOND);
    assert_error(
        p.post_bond_as(&outsider.wallet, outsider.token),
        ErrorCode::NotAMember,
    );
}

#[test]
fn two_votes_for_the_proposal_settle_the_epoch_on_it() {
    let mut p = Panel::ready();
    p.vote(0, ProposalWins).unwrap();
    assert_eq!(p.epoch().status, EpochStatus::Escalated);

    p.vote(2, ProposalWins).unwrap();
    let epoch = p.epoch();
    assert_eq!(epoch.status, EpochStatus::Settled);
    assert_eq!(epoch.result.unwrap().output_hash, [10u8; 32]);
    assert!(p.case().decided);
}

#[test]
fn two_votes_for_the_disputer_settle_the_epoch_on_its_alternative() {
    let mut p = Panel::ready();
    p.vote(1, DisputerWins).unwrap();
    p.vote(2, DisputerWins).unwrap();
    assert_eq!(p.epoch().result.unwrap().output_hash, [30u8; 32]);
}

#[test]
fn two_void_votes_void_the_epoch() {
    let mut p = Panel::ready();
    p.vote(0, Void).unwrap();
    p.vote(1, Void).unwrap();
    assert_eq!(p.epoch().status, EpochStatus::Voided);
}

#[test]
fn a_split_waits_for_the_third_vote() {
    let mut p = Panel::ready();
    p.vote(0, ProposalWins).unwrap();
    p.vote(1, DisputerWins).unwrap();
    assert_eq!(p.epoch().status, EpochStatus::Escalated);
    assert!(!p.case().decided);

    p.vote(2, DisputerWins).unwrap();
    assert_eq!(p.epoch().result.unwrap().output_hash, [30u8; 32]);
}

#[test]
fn a_three_way_split_voids_the_epoch() {
    let mut p = Panel::ready();
    p.vote(0, ProposalWins).unwrap();
    p.vote(1, DisputerWins).unwrap();
    p.vote(2, Void).unwrap();
    assert_eq!(p.epoch().status, EpochStatus::Voided);
}

#[test]
fn a_member_cannot_vote_twice() {
    let mut p = Panel::ready();
    p.vote(0, ProposalWins).unwrap();
    assert_error(p.vote(0, DisputerWins), ErrorCode::AlreadyVoted);
}

#[test]
fn no_vote_is_taken_once_the_panel_has_ruled() {
    let mut p = Panel::ready();
    p.vote(0, ProposalWins).unwrap();
    p.vote(1, ProposalWins).unwrap();
    assert_error(p.vote(2, DisputerWins), ErrorCode::CaseNotOpen);
    assert_eq!(p.epoch().result.unwrap().output_hash, [10u8; 32]);
}

#[test]
fn an_unbonded_member_cannot_vote() {
    let mut p = Panel::new();
    p.post_bond(1).unwrap();
    p.post_bond(2).unwrap();
    p.escalate();
    p.open_case().unwrap();
    assert_error(p.vote(0, ProposalWins), ErrorCode::MemberNotBonded);
}

#[test]
fn an_outsider_cannot_vote() {
    let mut p = Panel::ready();
    let outsider = Keypair::new();
    p.svm.airdrop(&outsider.pubkey(), 1_000_000_000).unwrap();
    assert_error(p.vote_as(&outsider, ProposalWins), ErrorCode::NotAMember);
}

#[test]
fn no_vote_after_the_14_day_deadline() {
    let mut p = Panel::ready();
    let escalated_at = p.epoch().escalated_at;
    p.vote(0, ProposalWins).unwrap();

    p.set_time(escalated_at + ARBITER_WINDOW + 1);
    assert_error(p.vote(1, ProposalWins), ErrorCode::DeadlinePassed);
    assert_eq!(p.epoch().status, EpochStatus::Escalated);
}

#[test]
fn a_case_opens_only_for_an_escalated_epoch() {
    let mut p = Panel::new();
    assert_error(p.open_case(), ErrorCode::CaseNotOpen);
}

#[test]
fn a_panel_needs_three_distinct_members_and_a_bond() {
    let mut p = Panel::without_panel();
    let authority = p.party(0).wallet;
    let [a, b, c] = [0, 1, 2].map(|_| Keypair::new().pubkey());

    assert_error(
        p.initialize_panel(&authority, [a, a, b], MEMBER_BOND),
        ErrorCode::DuplicateMember,
    );
    assert_error(
        p.initialize_panel(&authority, [a, b, anchor_lang::prelude::Pubkey::default()], MEMBER_BOND),
        ErrorCode::DuplicateMember,
    );
    assert_error(p.initialize_panel(&authority, [a, b, c], 0), ErrorCode::ZeroBond);
    p.initialize_panel(&authority, [a, b, c], MEMBER_BOND).unwrap();
}
