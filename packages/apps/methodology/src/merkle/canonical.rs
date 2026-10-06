use crate::error::EngineError;
use crate::merkle::MerkleTree;
use crate::types::Observation;

fn encode_field(buf: &mut Vec<u8>, field: &[u8]) {
    buf.extend_from_slice(&(field.len() as u32).to_be_bytes());
    buf.extend_from_slice(field);
}

pub fn canonicalize_observation(o: &Observation) -> Result<Vec<u8>, EngineError> {
    let raw_sha256 = o.raw_sha256.as_deref().ok_or(EngineError::MissingRawSha256)?;
    let mut buf = Vec::new();

    encode_field(&mut buf, b"EOX_OBSERVATION_V1");
    encode_field(&mut buf, o.country_iso3.as_bytes());
    encode_field(&mut buf, o.indicator_id.as_bytes());
    encode_field(&mut buf, o.period_start.as_bytes());
    encode_field(&mut buf, o.period_end.as_bytes());
    encode_field(&mut buf, o.value.as_bytes());
    encode_field(&mut buf, o.source_id.as_bytes());
    encode_field(&mut buf, o.vintage.as_bytes());
    encode_field(&mut buf, o.published_at.to_rfc3339().as_bytes());
    encode_field(&mut buf, o.known_at.to_rfc3339().as_bytes());
    let recipe_str = o.recipe_id.map(|r| r.to_string()).unwrap_or_default();
    encode_field(&mut buf, recipe_str.as_bytes());
    encode_field(&mut buf, raw_sha256.as_bytes());

    Ok(buf)
}

pub fn hash_observation(o: &Observation) -> Result<[u8; 32], EngineError> {
    let bytes = canonicalize_observation(o)?;
    Ok(MerkleTree::hash_leaf(&bytes))
}
