use crate::error::OracleError;
use crate::types::{ClaimStatus, EpochSettlementClaim};
use chrono::{DateTime, Utc};

pub struct ClaimManager;

impl ClaimManager {
    pub fn new_claim(
        epoch_id: &str,
        evidence_root: [u8; 32],
        methodology_image_id: [u8; 32],
        output_hash: [u8; 32],
        resolution_uri: &str,
        proposer: &str,
        bond: u64,
        liveness_seconds: u64,
        now: DateTime<Utc>,
    ) -> EpochSettlementClaim {
        EpochSettlementClaim {
            epoch_id: epoch_id.to_string(),
            evidence_root,
            methodology_image_id,
            output_hash,
            resolution_uri: resolution_uri.to_string(),
            proposer: proposer.to_string(),
            bond,
            proposed_at: now,
            liveness_seconds,
            status: ClaimStatus::Proposed,
            dispute_round: 0,
        }
    }

    pub fn dispute(
        claim: &mut EpochSettlementClaim,
        disputer_bond: u64,
    ) -> Result<ClaimStatus, OracleError> {
        if claim.status != ClaimStatus::Proposed {
            return Err(OracleError::InvalidStateTransition {
                from: format!("{:?}", claim.status),
                to: "Disputed".to_string(),
            });
        }

        if disputer_bond < claim.bond {
            return Err(OracleError::InsufficientBond {
                required: claim.bond,
                provided: disputer_bond,
            });
        }

        if claim.dispute_round == 0 {
            claim.dispute_round = 1;
            claim.status = ClaimStatus::Requested;
            Ok(ClaimStatus::Requested)
        } else {
            claim.dispute_round += 1;
            claim.status = ClaimStatus::Escalated;
            Ok(ClaimStatus::Escalated)
        }
    }

    pub fn check_and_settle(
        claim: &mut EpochSettlementClaim,
        now: DateTime<Utc>,
    ) -> Result<bool, OracleError> {
        if claim.status != ClaimStatus::Proposed {
            return Ok(false);
        }

        let elapsed = (now - claim.proposed_at).num_seconds();
        if elapsed >= claim.liveness_seconds as i64 {
            claim.status = ClaimStatus::SettledTrue;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub fn settle_with_proof(claim: &mut EpochSettlementClaim) -> Result<(), OracleError> {
        if claim.status != ClaimStatus::Proposed && claim.status != ClaimStatus::Requested {
            return Err(OracleError::InvalidStateTransition {
                from: format!("{:?}", claim.status),
                to: "SettledTrue".to_string(),
            });
        }
        claim.status = ClaimStatus::SettledTrue;
        Ok(())
    }
}
