use crate::engine::{evaluate_methodology, hash_output_bundle};
use crate::error::OracleError;
use crate::oracle::ClaimManager;
use crate::types::{EpochSettlementClaim, OutputBundle, Snapshot};
use chrono::Utc;

pub struct ProposerService;

impl ProposerService {
    pub fn create_proposal(
        snapshot: &Snapshot,
        epoch_id: &str,
        version: &str,
        methodology_image_id: [u8; 32],
        resolution_uri: &str,
        proposer: &str,
        bond: u64,
        liveness_seconds: u64,
    ) -> Result<(EpochSettlementClaim, OutputBundle), OracleError> {
        let bundle = evaluate_methodology(snapshot, epoch_id, version)?;
        let output_hash = hash_output_bundle(&bundle)?;
        let now = Utc::now();

        let claim = ClaimManager::new_claim(
            epoch_id,
            snapshot.evidence_root,
            methodology_image_id,
            output_hash,
            resolution_uri,
            proposer,
            bond,
            liveness_seconds,
            now,
        );

        Ok((claim, bundle))
    }
}
