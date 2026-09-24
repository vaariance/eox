use chrono::Utc;
use resolution_oracle::merkle::{canonicalize_observation, hash_observation, MerkleTree};
use resolution_oracle::types::Observation;

fn sample_observation(country: &str, indicator: &str, value: &str) -> Observation {
    let now = Utc::now();
    Observation {
        country_iso3: country.to_string(),
        indicator_id: indicator.to_string(),
        period_start: "2025-01-01".to_string(),
        period_end: "2025-03-31".to_string(),
        value: value.to_string(),
        source_id: "nbs-ng".to_string(),
        vintage: "first".to_string(),
        published_at: now,
        known_at: now,
        recipe_id: None,
        raw_sha256: None,
    }
}

#[test]
fn test_canonical_serialization_deterministic() {
    let obs1 = sample_observation("NGA", "gdp_real_growth_yoy", "3.2");
    let obs2 = obs1.clone();

    let bytes1 = canonicalize_observation(&obs1);
    let bytes2 = canonicalize_observation(&obs2);

    assert_eq!(bytes1, bytes2);
    assert_eq!(hash_observation(&obs1), hash_observation(&obs2));
}

#[test]
fn test_merkle_tree_proof_generation_and_verification() {
    let obs_list = vec![
        sample_observation("NGA", "gdp_real_growth_yoy", "3.2"),
        sample_observation("USA", "gdp_real_growth_yoy", "2.1"),
        sample_observation("CHN", "gdp_real_growth_yoy", "5.0"),
        sample_observation("IND", "gdp_real_growth_yoy", "6.8"),
    ];

    let leaves: Vec<[u8; 32]> = obs_list.iter().map(hash_observation).collect();
    let tree = MerkleTree::new(leaves.clone());
    let root = tree.root();

    for leaf in &leaves {
        let proof = tree.generate_proof(leaf).expect("proof generation failed");
        let valid = MerkleTree::verify_proof(&root, leaf, &proof);
        assert!(valid, "proof verification failed for leaf");

        let fake_leaf = [0xabu8; 32];
        let invalid = MerkleTree::verify_proof(&root, &fake_leaf, &proof);
        assert!(!invalid, "proof should not verify for tampered leaf");
    }
}
