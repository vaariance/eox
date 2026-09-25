use crate::engine::{evaluate_methodology, hash_output_bundle};
use crate::error::OracleError;
use crate::oracle::{BondVault, ClaimManager, NewClaimParams};
use crate::types::{EpochSettlementClaim, OutputBundle, Snapshot};
use chrono::Utc;

pub struct ProposalParams<'a> {
    pub epoch_id: &'a str,
    pub version: &'a str,
    pub methodology_image_id: [u8; 32],
    pub resolution_uri: &'a str,
    pub proposer: &'a str,
    pub bond: u64,
    pub liveness_seconds: u64,
}

pub struct ProposerService;

impl ProposerService {
    pub fn create_proposal(
        snapshot: &Snapshot,
        params: ProposalParams,
    ) -> Result<(EpochSettlementClaim, OutputBundle), OracleError> {
        let derived_root = crate::services::compute_evidence_root(&snapshot.observations)?;
        let mut snapshot_with_root = snapshot.clone();
        snapshot_with_root.evidence_root = derived_root;

        let bundle = evaluate_methodology(
            &snapshot_with_root,
            params.epoch_id,
            params.version,
            params.methodology_image_id,
        )?;
        let output_hash = hash_output_bundle(&bundle)?;
        let now = Utc::now();

        let claim = ClaimManager::new_claim(NewClaimParams {
            epoch_id: params.epoch_id,
            evidence_root: derived_root,
            methodology_image_id: params.methodology_image_id,
            output_hash,
            resolution_uri: params.resolution_uri,
            proposer: params.proposer,
            bond: params.bond,
            liveness_seconds: params.liveness_seconds,
            now,
        });

        Ok((claim, bundle))
    }

    pub fn create_bonded_proposal(
        snapshot: &Snapshot,
        params: ProposalParams,
        vault: &mut BondVault,
    ) -> Result<(EpochSettlementClaim, OutputBundle), OracleError> {
        let proposal = Self::create_proposal(snapshot, params)?;
        vault.deposit(&proposal.0.proposer, proposal.0.bond)?;
        Ok(proposal)
    }
}
