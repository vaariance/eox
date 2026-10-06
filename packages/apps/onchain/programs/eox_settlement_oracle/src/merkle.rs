use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

// Must match eox-engine's evidence tree exactly: a leaf is sha256(0x00 || canonical
// observation) and an inner node is sha256(0x01 || left || right). The prefixes stop an inner
// node from being passed off as an observation.
const LEAF_PREFIX: &[u8] = &[0x00];
const NODE_PREFIX: &[u8] = &[0x01];

pub const MAX_PROOF_DEPTH: usize = 16;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct ProofStep {
    pub is_right: bool,
    pub sibling: [u8; 32],
}

pub fn leaf_hash(observation: &[u8]) -> [u8; 32] {
    hashv(&[LEAF_PREFIX, observation]).to_bytes()
}

pub fn is_member(root: &[u8; 32], leaf: &[u8; 32], path: &[ProofStep]) -> bool {
    let computed = path.iter().fold(*leaf, |current, step| {
        if step.is_right {
            hashv(&[NODE_PREFIX, &step.sibling, &current]).to_bytes()
        } else {
            hashv(&[NODE_PREFIX, &current, &step.sibling]).to_bytes()
        }
    });
    &computed == root
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};
    use eox_engine::{
        merkle::{canonicalize_observation, hash_observation, MerkleTree},
        types::Observation,
    };

    fn observation(country: &str, indicator: &str, value: &str) -> Observation {
        let recorded = Utc.with_ymd_and_hms(2026, 7, 13, 0, 0, 0).unwrap();
        Observation {
            country_iso3: country.to_string(),
            indicator_id: indicator.to_string(),
            period_start: "2025-01-01".to_string(),
            period_end: "2025-12-31".to_string(),
            value: value.to_string(),
            source_id: "official".to_string(),
            vintage: "first".to_string(),
            published_at: Some(recorded),
            known_at: recorded,
            recipe_id: None,
            raw_sha256: Some("ab".repeat(32)),
        }
    }

    fn snapshot(size: usize) -> Vec<Observation> {
        (0..size)
            .map(|i| observation(&format!("C{i:02}"), "pmi", &format!("{}.5", 40 + i)))
            .collect()
    }

    #[test]
    fn leaf_hashes_match_the_engine() {
        for o in snapshot(5) {
            let bytes = canonicalize_observation(&o).unwrap();
            assert_eq!(leaf_hash(&bytes), hash_observation(&o).unwrap());
        }
    }

    #[test]
    fn every_engine_proof_verifies_for_every_tree_size() {
        for size in 1..=41 {
            let leaves: Vec<[u8; 32]> =
                snapshot(size).iter().map(|o| hash_observation(o).unwrap()).collect();
            let tree = MerkleTree::new(leaves.clone()).unwrap();
            for leaf in &leaves {
                let path: Vec<ProofStep> = tree
                    .generate_proof(leaf)
                    .unwrap()
                    .into_iter()
                    .map(|s| ProofStep { is_right: s.is_right, sibling: s.sibling })
                    .collect();
                assert!(is_member(&tree.root(), leaf, &path), "size {size}");
            }
        }
    }

    #[test]
    fn a_tampered_path_or_foreign_leaf_fails() {
        let leaves: Vec<[u8; 32]> =
            snapshot(8).iter().map(|o| hash_observation(o).unwrap()).collect();
        let tree = MerkleTree::new(leaves.clone()).unwrap();
        let mut path: Vec<ProofStep> = tree
            .generate_proof(&leaves[3])
            .unwrap()
            .into_iter()
            .map(|s| ProofStep { is_right: s.is_right, sibling: s.sibling })
            .collect();

        let foreign = hash_observation(&observation("XXX", "pmi", "1.0")).unwrap();
        assert!(!is_member(&tree.root(), &foreign, &path));

        path[0].sibling[0] ^= 1;
        assert!(!is_member(&tree.root(), &leaves[3], &path));
    }
}
