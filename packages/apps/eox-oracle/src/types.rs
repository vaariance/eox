use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

pub use eox_engine::types::*;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ClaimStatus {
    Requested,
    Proposed,
    Disputed,
    Escalated,
    SettledTrue,
    SettledFalse,
    Voided,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EpochSettlementClaim {
    pub epoch_id: String,
    pub evidence_root: [u8; 32],
    pub methodology_image_id: [u8; 32],
    pub output_hash: [u8; 32],
    pub resolution_uri: String,
    pub proposer: String,
    pub bond: u64,
    pub proposed_at: DateTime<Utc>,
    pub liveness_seconds: u64,
    pub status: ClaimStatus,
    pub dispute_round: u32,
}
