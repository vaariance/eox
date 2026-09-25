use crate::error::OracleError;
use crate::oracle::arbiter::Resolution;
use crate::types::{ClaimStatus, EpochSettlementClaim};
use chrono::{DateTime, Utc};

pub struct NewClaimParams<'a> {
    pub epoch_id: &'a str,
    pub evidence_root: [u8; 32],
    pub methodology_image_id: [u8; 32],
    pub output_hash: [u8; 32],
    pub resolution_uri: &'a str,
    pub proposer: &'a str,
    pub bond: u64,
    pub liveness_seconds: u64,
    pub now: DateTime<Utc>,
}

pub struct ClaimManager;

impl ClaimManager {
    pub fn new_claim(params: NewClaimParams) -> EpochSettlementClaim {
        EpochSettlementClaim {
            epoch_id: params.epoch_id.to_string(),
            evidence_root: params.evidence_root,
            methodology_image_id: params.methodology_image_id,
            output_hash: params.output_hash,
            resolution_uri: params.resolution_uri.to_string(),
            proposer: params.proposer.to_string(),
            bond: params.bond,
            proposed_at: params.now,
            liveness_seconds: params.liveness_seconds,
            status: ClaimStatus::Proposed,
            dispute_round: 0,
        }
    }

    pub fn re_propose(
        claim: &mut EpochSettlementClaim,
        output_hash: [u8; 32],
        proposer: &str,
        bond: u64,
        now: DateTime<Utc>,
    ) -> Result<(), OracleError> {
        if claim.status != ClaimStatus::Requested {
            return Err(OracleError::InvalidStateTransition {
                from: format!("{:?}", claim.status),
                to: "Proposed".to_string(),
            });
        }
        claim.output_hash = output_hash;
        claim.proposer = proposer.to_string();
        claim.bond = bond;
        claim.proposed_at = now;
        claim.status = ClaimStatus::Proposed;
        Ok(())
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

    pub fn resolve_arbitration(
        claim: &mut EpochSettlementClaim,
        resolution: Resolution,
    ) -> Result<ClaimStatus, OracleError> {
        if claim.status != ClaimStatus::Escalated {
            return Err(OracleError::InvalidStateTransition {
                from: format!("{:?}", claim.status),
                to: "Resolved".to_string(),
            });
        }

        match resolution {
            Resolution::Hash(h) if h == claim.output_hash => {
                claim.status = ClaimStatus::SettledTrue;
                Ok(ClaimStatus::SettledTrue)
            }
            Resolution::Hash(_) => {
                claim.status = ClaimStatus::SettledFalse;
                Ok(ClaimStatus::SettledFalse)
            }
            Resolution::Void => {
                claim.status = ClaimStatus::Voided;
                Ok(ClaimStatus::Voided)
            }
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
}
