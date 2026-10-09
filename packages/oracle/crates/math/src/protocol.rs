use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use crate::{digest, Hash, MathError, Result};

pub const EVIDENCE_DOMAIN: &str = "continuous-evidence-claim-v1";
pub const SNAPSHOT_DOMAIN: &str = "continuous-snapshot-claim-v1";
pub const RELAY_DOMAIN: &str = "continuous-relay-v1";
pub const ASSERTIONS_DOMAIN: &str = "continuous-assertion-set-v1";
pub const EVENTS_DOMAIN: &str = "continuous-event-history-v1";

mod decimal {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(v: &u64, s: S) -> std::result::Result<S::Ok, S::Error> { s.serialize_str(&v.to_string()) }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> std::result::Result<u64, D::Error> {
        let text = String::deserialize(d)?;
        let n: u64 = text.parse().map_err(serde::de::Error::custom)?;
        if text != n.to_string() { return Err(serde::de::Error::custom("noncanonical integer")); }
        Ok(n)
    }
}

#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClaimContext {
    pub version: u16,
    #[serde(with = "decimal")] pub evm_chain_id: u64,
    pub adapter: [u8; 20],
    pub solana_program: Hash,
    pub registry: Hash,
    #[serde(with = "decimal")] pub epoch: u64,
    pub methodology_manifest: Hash,
    pub configuration_digest: Hash,
    pub evidence_policy: Hash,
}
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvidenceClaim {
    pub context: ClaimContext,
    pub evidence_digest: Hash,
    pub metadata_digest: Hash,
    pub record_id: String,
    pub artifact_digests: Vec<Hash>,
    pub assessment_digest: Hash,
    pub provenance_digests: Vec<Hash>,
}
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvidenceBinding { pub record_id: String, pub evidence_digest: Hash, pub assessment_digest: Hash, pub assertion_id: Hash }
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClaimSlot { pub country: u8, pub indicator: u8, pub current: EvidenceBinding, pub comparison: Option<EvidenceBinding> }
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SnapshotClaim {
    pub context: ClaimContext,
    pub proposal: Hash,
    pub precommitment: Hash,
    pub predecessor: Option<Hash>,
    #[serde(with = "decimal")] pub cutoff: u64,
    pub slots: Vec<ClaimSlot>,
    pub evidence_assertions: Vec<Hash>,
}
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RelayHeader {
    pub version: u16,
    #[serde(with = "decimal")] pub evm_chain_id: u64,
    pub wormhole_chain: u16,
    pub adapter: [u8; 20],
    pub solana_program: Hash,
    pub registry: Hash,
    #[serde(with = "decimal")] pub epoch: u64,
    pub proposal: Hash,
    pub precommitment: Hash,
    #[serde(with = "decimal")] pub event_number: u64,
}
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
pub enum ClaimKind { Evidence, Snapshot }
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum RelayEvent {
    Registered { uma: [u8; 20], assertion_id: Hash, claim_kind: ClaimKind, claim_digest: Hash, subject: Hash, #[serde(with = "decimal")] start: u64, #[serde(with = "decimal")] deadline: u64 },
    Disputed { assertion_id: Hash, subject: Hash, dispute_id: Hash },
    Settled { assertion_id: Hash, subject: Hash, accepted: bool, disputed: bool, #[serde(with = "decimal")] settled_at: u64 },
    Closed { assertion_set_digest: Hash, #[serde(with = "decimal")] event_count: u64, event_digest: Hash, accepted: bool },
}
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RelayMessage { pub header: RelayHeader, pub event: RelayEvent }

fn valid(ok: bool) -> Result<()> { if ok { Ok(()) } else { Err(MathError::Encoding) } }
fn hashes(v: &[Hash], max: usize) -> Result<()> { valid(!v.is_empty() && v.len() <= max && v.windows(2).all(|p| p[0] < p[1])) }
impl EvidenceClaim {
    pub fn validate(&self) -> Result<()> {
        valid(self.context.version == 1 && !self.record_id.is_empty() && self.record_id.len() <= 256)?;
        hashes(&self.artifact_digests, 64)?; hashes(&self.provenance_digests, 64)
    }
    pub fn encode(&self) -> Result<Vec<u8>> { self.validate()?; self.try_to_vec().map_err(|_| MathError::Encoding) }
    pub fn commitment(&self) -> Result<Hash> { self.validate()?; digest(EVIDENCE_DOMAIN, self) }
}
impl SnapshotClaim {
    pub fn validate(&self) -> Result<()> {
        valid(self.context.version == 1 && !self.slots.is_empty() && self.slots.len() <= 960)?;
        hashes(&self.evidence_assertions, 1920)?;
        let mut previous = None;
        let mut required = BTreeSet::new();
        let mut bindings = BTreeMap::new();
        for slot in &self.slots {
            let order = slot.country as u16 * 32 + slot.indicator as u16;
            valid(slot.country < 30 && slot.indicator < 32 && previous.map_or(true, |p| order > p))?;
            previous = Some(order); required.insert(slot.current.assertion_id);
            if let Some(c) = &slot.comparison { required.insert(c.assertion_id); }
            for b in std::iter::once(&slot.current).chain(slot.comparison.iter()) {
                valid(!b.record_id.is_empty() && b.record_id.len() <= 256)?;
                let encoded = b.try_to_vec().map_err(|_| MathError::Encoding)?;
                if let Some(previous) = bindings.insert(b.assertion_id, encoded.clone()) { valid(previous == encoded)?; }
            }
        }
        valid(required.into_iter().collect::<Vec<_>>() == self.evidence_assertions)
    }
    pub fn encode(&self) -> Result<Vec<u8>> { self.validate()?; self.try_to_vec().map_err(|_| MathError::Encoding) }
    pub fn commitment(&self) -> Result<Hash> { self.validate()?; digest(SNAPSHOT_DOMAIN, self) }
}
impl RelayMessage {
    pub fn validate(&self) -> Result<()> {
        valid(self.header.version == 1 && self.header.event_number > 0)?;
        match &self.event {
            RelayEvent::Registered { start, deadline, .. } => valid(start.checked_add(3600) == Some(*deadline)),
            RelayEvent::Closed { event_count, .. } => valid(event_count.checked_add(1) == Some(self.header.event_number)),
            _ => Ok(()),
        }
    }
    pub fn encode(&self) -> Result<Vec<u8>> { self.validate()?; self.try_to_vec().map_err(|_| MathError::Encoding) }
    pub fn commitment(&self) -> Result<Hash> { self.validate()?; digest(RELAY_DOMAIN, self) }
}
pub fn assertion_set_digest(evidence: &[Hash], snapshot: Hash) -> Result<Hash> {
    hashes(evidence, 1920)?; valid(!evidence.contains(&snapshot))?;
    digest(ASSERTIONS_DOMAIN, &(evidence, snapshot))
}
pub fn event_history_digest(previous: Hash, message: &RelayMessage) -> Result<Hash> {
    valid(!matches!(message.event, RelayEvent::Closed { .. }))?;
    digest(EVENTS_DOMAIN, &(previous, message.commitment()?))
}
