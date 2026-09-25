use crate::engine::{evaluate_methodology, hash_output_bundle};
use crate::error::OracleError;
use crate::oracle::{BondVault, ClaimManager};
use crate::types::{EpochSettlementClaim, Snapshot};

#[derive(Debug, PartialEq, Eq)]
pub enum WatchtowerResult {
    Valid,
    Disputed { reason: String },
}

pub struct WatchtowerService;

impl WatchtowerService {
    pub fn verify_and_guard(
        claim: &mut EpochSettlementClaim,
        snapshot: &Snapshot,
        version: &str,
        disputer: &str,
        disputer_bond: u64,
        vault: &mut BondVault,
    ) -> Result<WatchtowerResult, OracleError> {
        let computed_root = crate::services::compute_evidence_root(&snapshot.observations)?;
        if computed_root != claim.evidence_root {
            ClaimManager::dispute(claim, disputer_bond)?;
            vault.deposit(disputer, disputer_bond)?;
            return Ok(WatchtowerResult::Disputed {
                reason: format!(
                    "Evidence root mismatch: expected {}, proposed {}",
                    hex::encode(computed_root),
                    hex::encode(claim.evidence_root)
                ),
            });
        }

        let bundle = evaluate_methodology(
            snapshot,
            &claim.epoch_id,
            version,
            claim.methodology_image_id,
        )?;
        let expected_ho = hash_output_bundle(&bundle)?;

        if expected_ho != claim.output_hash {
            ClaimManager::dispute(claim, disputer_bond)?;
            vault.deposit(disputer, disputer_bond)?;
            return Ok(WatchtowerResult::Disputed {
                reason: format!(
                    "Output hash Ho mismatch: expected {}, proposed {}",
                    hex::encode(expected_ho),
                    hex::encode(claim.output_hash)
                ),
            });
        }

        Ok(WatchtowerResult::Valid)
    }
}
