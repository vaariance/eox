use crate::error::EngineError;
use crate::types::OutputBundle;
use sha2::{Digest, Sha256};

fn encode_field(buf: &mut Vec<u8>, field: &[u8]) {
    buf.extend_from_slice(&(field.len() as u32).to_be_bytes());
    buf.extend_from_slice(field);
}

pub fn canonicalize_output_bundle(bundle: &OutputBundle) -> Vec<u8> {
    let mut buf = Vec::new();

    encode_field(&mut buf, b"EOX_OUTPUT_BUNDLE_V1");
    encode_field(&mut buf, bundle.epoch_id.as_bytes());
    encode_field(&mut buf, bundle.as_of.as_bytes());
    encode_field(&mut buf, bundle.methodology_version.as_bytes());
    encode_field(&mut buf, &bundle.evidence_root);
    encode_field(&mut buf, &bundle.methodology_image_id);

    buf.extend_from_slice(&(bundle.country_scores.len() as u32).to_be_bytes());
    for cs in &bundle.country_scores {
        encode_field(&mut buf, cs.country_iso3.as_bytes());
        encode_field(&mut buf, cs.score.as_bytes());
    }

    encode_field(&mut buf, bundle.world_benchmark.as_bytes());

    buf.extend_from_slice(&(bundle.relative_scores.len() as u32).to_be_bytes());
    for rs in &bundle.relative_scores {
        encode_field(&mut buf, rs.country_iso3.as_bytes());
        encode_field(&mut buf, rs.relative_performance.as_bytes());
    }

    buf.extend_from_slice(&(bundle.attribution.len() as u32).to_be_bytes());
    for trace in &bundle.attribution {
        encode_field(&mut buf, trace.country_iso3.as_bytes());
        encode_field(&mut buf, trace.indicator_id.as_bytes());
        encode_field(&mut buf, trace.raw_value.as_bytes());
        encode_field(&mut buf, trace.normalized_score.as_bytes());
        encode_field(&mut buf, trace.weight.as_bytes());
    }

    buf
}

pub fn hash_output_bundle(bundle: &OutputBundle) -> Result<[u8; 32], EngineError> {
    let bytes = canonicalize_output_bundle(bundle);
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(hasher.finalize().into())
}
