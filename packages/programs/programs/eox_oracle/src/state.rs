use anchor_lang::prelude::*;

use crate::constants::MAX_PROPOSERS;

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
    Settled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct Claim {
    pub evidence_root: [u8; 32],
    pub methodology_image_id: [u8; 32],
    pub output_hash: [u8; 32],
    pub resolution_uri_hash: [u8; 32],
    pub proposer: Pubkey,
    pub bond: u64,
    pub proposed_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct Epoch {
    pub year: u16,
    pub cutoff: i64,
    pub bond: u64,
    pub status: EpochStatus,
    pub claim: Option<Claim>,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Balance {
    pub owner: Pubkey,
    pub amount: u64,
    pub bump: u8,
}
