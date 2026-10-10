use borsh::BorshDeserialize;
use crate::{protocol::{RelayEvent, RelayMessage}, Hash, MathError, Result};

pub const MAX_RELAY_BYTES: usize = 512;
pub const POSTED_HEADER_BYTES: usize = 95;

pub struct RelayDestination {
    pub wormhole_program: Hash,
    pub evm_chain_id: u64,
    pub wormhole_chain: u16,
    pub emitter: Hash,
    pub adapter: [u8; 20],
    pub uma: [u8; 20],
    pub program: Hash,
    pub registry: Hash,
    pub epoch: u64,
    pub proposal: Hash,
    pub precommitment: Hash,
    pub consistency_level: u8,
}

pub struct VerifiedRelay {
    pub wormhole_sequence: u64,
    pub message: RelayMessage,
}

pub fn decode_relay(payload: &[u8]) -> Result<RelayMessage> {
    if payload.len() > MAX_RELAY_BYTES { return Err(MathError::Encoding); }
    let message = RelayMessage::try_from_slice(payload).map_err(|_| MathError::Encoding)?;
    message.validate()?;
    let times_valid = match &message.event {
        RelayEvent::Registered { start, deadline, claim_digest, subject, .. } => {
            *start <= i64::MAX as u64 && *deadline <= i64::MAX as u64 && claim_digest == subject
        },
        RelayEvent::Settled { settled_at, .. } => *settled_at <= i64::MAX as u64,
        _ => true,
    };
    if !times_valid { return Err(MathError::Encoding); }
    Ok(message)
}

pub fn verify_posted_relay(owner: Hash, data: &[u8], destination: &RelayDestination) -> Result<VerifiedRelay> {
    if owner != destination.wormhole_program || data.len() < POSTED_HEADER_BYTES
        || data.len() > POSTED_HEADER_BYTES + MAX_RELAY_BYTES
        || &data[..3] != b"vaa" || data[3] != 1
        || data[4] != destination.consistency_level {
        return Err(MathError::Encoding);
    }
    let sequence = u64::from_le_bytes(data[49..57].try_into().map_err(|_| MathError::Encoding)?);
    let chain = u16::from_le_bytes(data[57..59].try_into().map_err(|_| MathError::Encoding)?);
    let length = u32::from_le_bytes(data[91..95].try_into().map_err(|_| MathError::Encoding)?) as usize;
    if chain != destination.wormhole_chain || data[59..91] != destination.emitter
        || length != data.len() - POSTED_HEADER_BYTES {
        return Err(MathError::Encoding);
    }
    let message = decode_relay(&data[POSTED_HEADER_BYTES..])?;
    let h = &message.header;
    if h.evm_chain_id != destination.evm_chain_id || h.wormhole_chain != chain
        || h.adapter != destination.adapter || h.solana_program != destination.program
        || h.registry != destination.registry || h.epoch != destination.epoch
        || h.proposal != destination.proposal || h.precommitment != destination.precommitment {
        return Err(MathError::Encoding);
    }
    if let RelayEvent::Registered { uma, .. } = &message.event {
        if *uma != destination.uma { return Err(MathError::Encoding); }
    }
    Ok(VerifiedRelay { wormhole_sequence: sequence, message })
}
