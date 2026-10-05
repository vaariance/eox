//! Turns a snapshot into a claim and posts it, with the bond, while the epoch accepts one.

use eox_engine::{evaluate_methodology, hash_output_bundle, merkle::compute_evidence_root};
use eox_settlement_oracle::{
    constants::PROPOSAL_WINDOW,
    state::{ClaimBody, Epoch, EpochStatus},
};
use sha2::{Digest, Sha256};
use solana_keypair::Keypair;
use solana_signer::Signer;

use crate::chain::{bond_account, epoch_label, instructions, Chain};
use crate::error::OracleError;
use crate::types::{OutputBundle, Snapshot};

/// A claim as it goes on-chain, plus the bundle it commits to. The proposer publishes the
/// snapshot and bundle at the resolution URI so watchers can check them.
#[derive(Debug, Clone)]
pub struct Claim {
    pub body: ClaimBody,
    pub bundle: OutputBundle,
}

pub fn resolution_uri_hash(uri: &str) -> [u8; 32] {
    Sha256::digest(uri.as_bytes()).into()
}

/// Runs the engine over `snapshot` exactly as every honest party must for this epoch.
pub fn build_claim(
    snapshot: &Snapshot,
    epoch: &Epoch,
    version: &str,
    resolution_uri: &str,
) -> Result<Claim, OracleError> {
    let mut snapshot = snapshot.clone();
    snapshot.evidence_root = compute_evidence_root(&snapshot.observations)?;
    let bundle = evaluate_methodology(
        &snapshot,
        &epoch_label(epoch.year),
        version,
        epoch.methodology_image_id,
    )?;
    let body = ClaimBody {
        evidence_root: snapshot.evidence_root,
        methodology_image_id: epoch.methodology_image_id,
        output_hash: hash_output_bundle(&bundle)?,
        resolution_uri_hash: resolution_uri_hash(resolution_uri),
    };
    Ok(Claim { body, bundle })
}

/// Whether the program would take a proposal now. Mirrors the program's own bounds.
pub fn accepting_proposals(epoch: &Epoch, now: i64) -> bool {
    match epoch.status {
        EpochStatus::Requested => now >= epoch.cutoff && now <= epoch.cutoff + PROPOSAL_WINDOW,
        EpochStatus::Reset => now <= epoch.reset_at + PROPOSAL_WINDOW,
        _ => false,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProposeOutcome {
    Proposed(ClaimBody),
    /// The epoch is not open, already has a live claim, or is finished.
    NotAccepting,
}

pub fn propose(
    chain: &mut impl Chain,
    year: u16,
    proposer: &Keypair,
    snapshot: &Snapshot,
    version: &str,
    resolution_uri: &str,
) -> Result<ProposeOutcome, OracleError> {
    let Some(epoch) = chain.epoch(year)? else {
        return Ok(ProposeOutcome::NotAccepting);
    };
    if !accepting_proposals(&epoch, chain.now()?) {
        return Ok(ProposeOutcome::NotAccepting);
    }
    let claim = build_claim(snapshot, &epoch, version, resolution_uri)?;
    let token = bond_account(&proposer.pubkey(), &chain.config()?.bond_mint);
    chain.send(
        instructions::propose(year, proposer.pubkey(), token, claim.body),
        proposer,
    )?;
    Ok(ProposeOutcome::Proposed(claim.body))
}
