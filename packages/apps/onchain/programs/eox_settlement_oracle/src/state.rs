use anchor_lang::prelude::*;

use crate::constants::{MAX_PARTIES, MAX_PROPOSERS};

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub bond_mint: Pubkey,
    pub arbiter: Pubkey,
    #[max_len(MAX_PROPOSERS)]
    pub proposers: Vec<Pubkey>,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum EpochStatus {
    Requested,
    Proposed,
    Reset,
    Escalated,
    Settled,
    Voided,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum Resolution {
    ProposalWins,
    DisputerWins,
    Void,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct ClaimBody {
    pub evidence_root: [u8; 32],
    pub methodology_image_id: [u8; 32],
    pub output_hash: [u8; 32],
    pub resolution_uri_hash: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct Proposal {
    pub body: ClaimBody,
    pub proposer: Pubkey,
    pub bond: u64,
    pub proposed_at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct Dispute {
    pub candidate: ClaimBody,
    pub disputer: Pubkey,
    pub bond: u64,
    pub disputed_at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, Default, InitSpace)]
pub struct Payout {
    pub owner: Pubkey,
    pub amount: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Epoch {
    pub year: u16,
    pub cutoff: i64,
    pub bond: u64,
    pub status: EpochStatus,
    pub round: u8,
    pub proposals: [Option<Proposal>; 2],
    pub disputes: [Option<Dispute>; 2],
    pub reset_at: i64,
    pub escalated_at: i64,
    pub result: Option<ClaimBody>,
    pub payouts: [Payout; MAX_PARTIES],
    pub burn_owed: u64,
    pub bump: u8,
}

impl Epoch {
    pub fn new(year: u16, cutoff: i64, bond: u64, bump: u8) -> Self {
        Self {
            year,
            cutoff,
            bond,
            status: EpochStatus::Requested,
            round: 0,
            proposals: [None; 2],
            disputes: [None; 2],
            reset_at: 0,
            escalated_at: 0,
            result: None,
            payouts: [Payout::default(); MAX_PARTIES],
            burn_owed: 0,
            bump,
        }
    }

    pub fn is_resolved(&self) -> bool {
        matches!(self.status, EpochStatus::Settled | EpochStatus::Voided)
    }
}
