use crate::types::Observation;
use sha2::{Digest, Sha256};

pub fn canonicalize_observation(o: &Observation) -> Vec<u8> {
    let canonical = format!(
        "country_iso3:{}\nindicator_id:{}\nknown_at:{}\nperiod_end:{}\nperiod_start:{}\npublished_at:{}\nsource_id:{}\nvalue:{}\nvintage:{}",
        o.country_iso3,
        o.indicator_id,
        o.known_at.to_rfc3339(),
        o.period_end,
        o.period_start,
        o.published_at.to_rfc3339(),
        o.source_id,
        o.value,
        o.vintage
    );
    canonical.into_bytes()
}

pub fn hash_observation(o: &Observation) -> [u8; 32] {
    let bytes = canonicalize_observation(o);
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    hasher.finalize().into()
}
