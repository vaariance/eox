#![allow(dead_code)]

use std::collections::HashMap;

use anchor_lang::{prelude::Pubkey, solana_program::instruction::Instruction, AccountSerialize};
use eox_oracle::chain::{config_address, epoch_address, Chain};
use eox_oracle::error::OracleError;
use eox_oracle::types::{Observation, Snapshot};
use eox_settlement_oracle::{
    constants::cutoff_timestamp,
    state::{Config, Epoch},
};
use solana_keypair::Keypair;
use solana_signer::Signer;

pub const YEAR: u16 = 2025;
pub const BOND: u64 = 10_000_000_000;
pub const IMAGE_ID: [u8; 32] = [2u8; 32];
pub const VERSION: &str = "v0.1";
pub const URI: &str = "ipfs://mock-snapshot-2025";

/// Mocked evidence for epoch 2025: five countries by five v0.1 indicators, all known
/// before the cutoff. The same file works with `eox-oracle run-engine`.
const MOCK_SNAPSHOT: &str = include_str!("../../fixtures/mock-snapshot-2025.json");

pub fn mock_snapshot() -> Snapshot {
    let mut snapshot: Snapshot = serde_json::from_str(MOCK_SNAPSHOT).unwrap();
    snapshot.evidence_root =
        eox_oracle::services::compute_evidence_root(&snapshot.observations).unwrap();
    snapshot
}

pub fn full_observations() -> Vec<Observation> {
    mock_snapshot().observations
}

/// The same snapshot with its observations replaced, and the root recomputed to match.
pub fn with_observations(observations: Vec<Observation>) -> Snapshot {
    let mut snapshot = mock_snapshot();
    snapshot.evidence_root = eox_oracle::services::compute_evidence_root(&observations).unwrap();
    snapshot.observations = observations;
    snapshot
}

pub fn cutoff() -> i64 {
    cutoff_timestamp(YEAR)
}

/// An in-memory stand-in for the cluster. Holds program accounts as their serialized bytes,
/// so the bots decode them exactly as they would over RPC, and records every instruction
/// sent instead of executing it.
pub struct MockChain {
    pub now: i64,
    pub accounts: HashMap<Pubkey, Vec<u8>>,
    pub sent: Vec<(Instruction, Pubkey)>,
    pub bond_mint: Pubkey,
}

impl MockChain {
    pub fn new(now: i64) -> Self {
        let bond_mint = Pubkey::new_unique();
        let config = Config {
            authority: Pubkey::new_unique(),
            bond_mint,
            arbiter: Pubkey::new_unique(),
            proposers: vec![],
            bump: 255,
        };
        let mut chain = Self {
            now,
            accounts: HashMap::new(),
            sent: Vec::new(),
            bond_mint,
        };
        chain.accounts.insert(config_address(), serialize(&config));
        chain
    }

    /// A chain with epoch `YEAR` opened and waiting for its first proposal.
    pub fn with_open_epoch(now: i64) -> Self {
        let mut chain = Self::new(now);
        chain.set_epoch(&Epoch::new(YEAR, cutoff(), BOND, IMAGE_ID, 254));
        chain
    }

    pub fn set_epoch(&mut self, epoch: &Epoch) {
        self.accounts
            .insert(epoch_address(epoch.year), serialize(epoch));
    }

    pub fn stored_epoch(&self) -> Epoch {
        self.epoch(YEAR).unwrap().unwrap()
    }
}

fn serialize<T: AccountSerialize>(account: &T) -> Vec<u8> {
    let mut data = Vec::new();
    account.try_serialize(&mut data).unwrap();
    data
}

impl Chain for MockChain {
    fn now(&self) -> Result<i64, OracleError> {
        Ok(self.now)
    }

    fn account_data(&self, address: &Pubkey) -> Result<Option<Vec<u8>>, OracleError> {
        Ok(self.accounts.get(address).cloned())
    }

    fn send(&mut self, instruction: Instruction, signer: &Keypair) -> Result<String, OracleError> {
        self.sent.push((instruction, signer.pubkey()));
        Ok(format!("mock-signature-{}", self.sent.len()))
    }
}
