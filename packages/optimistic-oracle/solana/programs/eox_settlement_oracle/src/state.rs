use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    /// The Wormhole core bridge program. Verified VAAs are accounts it owns.
    pub wormhole_program: Pubkey,
    /// Wormhole chain ID of the chain the EVM adapter lives on (Base is 30).
    pub emitter_chain: u16,
    /// The EVM adapter's address, left-padded to 32 bytes, as Wormhole names emitters.
    pub emitter_address: [u8; 32],
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum EpochStatus {
    /// Waiting for a result.
    Open,
    Settled,
    /// No result arrived by the deadline.
    Voided,
}

/// The hashes a result commits to. Matches `Claim` in the EVM adapter.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct ClaimBody {
    pub evidence_root: [u8; 32],
    pub methodology_image_id: [u8; 32],
    pub output_hash: [u8; 32],
    pub resolution_uri_hash: [u8; 32],
}

#[account]
#[derive(InitSpace)]
pub struct Epoch {
    pub year: u16,
    pub cutoff: i64,
    pub methodology_image_id: [u8; 32],
    pub status: EpochStatus,
    pub result: Option<ClaimBody>,
    /// The UMA assertion that settled the epoch.
    pub assertion_id: [u8; 32],
    /// Sequence of the Wormhole message the result arrived in.
    pub wormhole_sequence: u64,
    pub bump: u8,
}

impl Epoch {
    pub fn new(year: u16, cutoff: i64, methodology_image_id: [u8; 32], bump: u8) -> Self {
        Self {
            year,
            cutoff,
            methodology_image_id,
            status: EpochStatus::Open,
            result: None,
            assertion_id: [0; 32],
            wormhole_sequence: 0,
            bump,
        }
    }
}
