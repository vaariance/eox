use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Observation {
    pub country_iso3: String,
    pub indicator_id: String,
    pub period_start: String,
    pub period_end: String,
    pub value: String,
    pub source_id: String,
    pub vintage: String,
    pub published_at: DateTime<Utc>,
    pub known_at: DateTime<Utc>,
    pub recipe_id: Option<i32>,
    pub raw_sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Snapshot {
    pub as_of: DateTime<Utc>,
    pub observations: Vec<Observation>,
    pub evidence_root: [u8; 32],
}

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CountryScore {
    pub country_iso3: String,
    pub score: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RelativeScore {
    pub country_iso3: String,
    pub relative_performance: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IndicatorTrace {
    pub country_iso3: String,
    pub indicator_id: String,
    pub raw_value: String,
    pub normalized_score: String,
    pub weight: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OutputBundle {
    pub epoch_id: String,
    pub as_of: String,
    pub methodology_version: String,
    pub country_scores: Vec<CountryScore>,
    pub world_benchmark: String,
    pub relative_scores: Vec<RelativeScore>,
    pub attribution: Vec<IndicatorTrace>,
}
