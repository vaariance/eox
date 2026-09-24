use crate::db;
use crate::error::OracleError;
use crate::merkle::{hash_observation, MerkleTree};
use crate::types::{Observation, Snapshot};
use chrono::{DateTime, Utc};
use tokio_postgres::Client;

pub fn build_snapshot(as_of: DateTime<Utc>, observations: Vec<Observation>) -> Snapshot {
    let leaves: Vec<[u8; 32]> = observations.iter().map(hash_observation).collect();
    let tree = MerkleTree::new(leaves);
    Snapshot {
        as_of,
        observations,
        evidence_root: tree.root(),
    }
}

pub async fn fetch_snapshot(
    client: &Client,
    as_of: DateTime<Utc>,
    universe: &[String],
    indicators: &[String],
) -> Result<Snapshot, OracleError> {
    let observations = db::get_as_of(client, as_of, universe, indicators).await?;
    Ok(build_snapshot(as_of, observations))
}
