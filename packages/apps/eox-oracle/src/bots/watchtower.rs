//! Re-runs the engine on its own copy of the evidence and challenges any live claim that
//! disagrees, naming the exact observation where it can.

use std::collections::{HashMap, HashSet};

use eox_engine::merkle::{canonicalize_observation, compute_evidence_root, hash_observation, MerkleTree};
use eox_settlement_oracle::{
    constants::CHALLENGE_WINDOW,
    merkle::ProofStep,
    state::{ClaimBody, Epoch, EpochStatus},
    Grounds,
};
use solana_keypair::Keypair;
use solana_signer::Signer;

use super::proposer::build_claim;
use crate::chain::{bond_account, instructions, Chain};
use crate::error::OracleError;
use crate::types::{Observation, Snapshot};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    /// Our evidence gives the same result as the claim.
    Agrees,
    /// The challenge we file, or filed.
    Dispute { candidate: ClaimBody, grounds: Grounds },
    /// We disagree, but cannot build grounds the program will accept. Needs a person.
    CannotVerify(String),
}

/// Compares a claim with what our own evidence produces. `published` is the snapshot the
/// proposer published at the claim's resolution URI, if we could get it.
pub fn assess(
    claim: &ClaimBody,
    epoch: &Epoch,
    ours: &Snapshot,
    published: Option<&Snapshot>,
    version: &str,
    resolution_uri: &str,
) -> Result<Verdict, OracleError> {
    let candidate = build_claim(ours, epoch, version, resolution_uri)?.body;
    if candidate.output_hash == claim.output_hash {
        return Ok(Verdict::Agrees);
    }
    if candidate.evidence_root == claim.evidence_root {
        return Ok(Verdict::Dispute { candidate, grounds: Grounds::Computation });
    }

    let Some(published) = published else {
        return Ok(Verdict::CannotVerify(
            "the evidence differs, but the claim's snapshot is not available to name what differs".into(),
        ));
    };
    if compute_evidence_root(&published.observations)? != claim.evidence_root {
        return Ok(Verdict::CannotVerify(
            "the published snapshot does not match the claim's evidence root".into(),
        ));
    }
    let grounds = evidence_grounds(&published.observations, &ours.observations)?;
    Ok(Verdict::Dispute { candidate, grounds })
}

type Key<'a> = (&'a str, &'a str, &'a str, &'a str);

fn key(o: &Observation) -> Key<'_> {
    (&o.country_iso3, &o.indicator_id, &o.period_start, &o.period_end)
}

/// Prefers naming a wrong observation, since the program checks that one itself. Falls back
/// to a missing one only when every observation in the claim is also in ours.
fn evidence_grounds(claimed: &[Observation], ours: &[Observation]) -> Result<Grounds, OracleError> {
    let our_leaves = ours
        .iter()
        .map(|o| Ok((key(o), hash_observation(o)?)))
        .collect::<Result<Vec<_>, OracleError>>()?;
    let our_leaf_set: HashSet<[u8; 32]> = our_leaves.iter().map(|(_, leaf)| *leaf).collect();
    let our_by_key: HashMap<Key, [u8; 32]> = our_leaves.iter().copied().collect();

    let claimed_leaves = claimed
        .iter()
        .map(hash_observation)
        .collect::<Result<Vec<_>, _>>()?;
    let tree = MerkleTree::new(claimed_leaves.clone())?;

    if let Some((observation, leaf)) = claimed
        .iter()
        .zip(&claimed_leaves)
        .find(|(_, leaf)| !our_leaf_set.contains(*leaf))
    {
        let path = tree
            .generate_proof(leaf)?
            .into_iter()
            .map(|step| ProofStep { is_right: step.is_right, sibling: step.sibling })
            .collect();
        return Ok(Grounds::WrongObservation {
            observation: canonicalize_observation(observation)?,
            path,
            // No observation of ours for this slot means it should not be there at all.
            correction: our_by_key.get(&key(observation)).copied(),
        });
    }

    let claimed_set: HashSet<[u8; 32]> = claimed_leaves.into_iter().collect();
    our_leaves
        .iter()
        .find(|(_, leaf)| !claimed_set.contains(leaf))
        .map(|(_, leaf)| Grounds::MissingObservation { correction: *leaf })
        .ok_or_else(|| OracleError::InconsistentEvidence("the evidence roots differ but the observations match".into()))
}

/// Checks the epoch's live claim, if there is one, and files a challenge when we disagree.
/// Returns `None` when there is no claim open to challenge.
pub fn watch(
    chain: &mut impl Chain,
    year: u16,
    disputer: &Keypair,
    ours: &Snapshot,
    published: Option<&Snapshot>,
    version: &str,
    resolution_uri: &str,
) -> Result<Option<Verdict>, OracleError> {
    let Some(epoch) = chain.epoch(year)? else {
        return Ok(None);
    };
    if epoch.status != EpochStatus::Proposed {
        return Ok(None);
    }
    let Some(proposal) = epoch.proposals[usize::from(epoch.round) - 1] else {
        return Ok(None);
    };
    if chain.now()? >= proposal.proposed_at + CHALLENGE_WINDOW {
        return Ok(None);
    }

    let verdict = assess(&proposal.body, &epoch, ours, published, version, resolution_uri)?;
    if let Verdict::Dispute { candidate, grounds } = &verdict {
        let token = bond_account(&disputer.pubkey(), &chain.config()?.bond_mint);
        chain.send(
            instructions::dispute(year, disputer.pubkey(), token, *candidate, grounds.clone()),
            disputer,
        )?;
    }
    Ok(Some(verdict))
}
