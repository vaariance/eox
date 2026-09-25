use chrono::Utc;
use eox_engine::merkle::{canonicalize_observation, hash_observation, MerkleTree};
use eox_engine::types::Observation;
use eox_engine::EngineError;

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
        recipe_id: Some(1),
        raw_sha256: Some("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string()),
    }
}

#[test]
fn test_canonical_serialization_deterministic() {
    let obs1 = sample_observation("NGA", "gdp_real_growth_yoy", "3.2");
    let obs2 = obs1.clone();

    let bytes1 = canonicalize_observation(&obs1).unwrap();
    let bytes2 = canonicalize_observation(&obs2).unwrap();

    assert_eq!(bytes1, bytes2);
    assert_eq!(
        hash_observation(&obs1).unwrap(),
        hash_observation(&obs2).unwrap()
    );
}

#[test]
fn test_canonical_encoding_requires_raw_sha256() {
    let mut obs = sample_observation("NGA", "gdp_real_growth_yoy", "3.2");
    obs.raw_sha256 = None;
    assert!(matches!(
        hash_observation(&obs),
        Err(EngineError::MissingRawSha256)
    ));
}

#[test]
fn test_canonical_encoding_escapes_newlines() {
    let mut obs1 = sample_observation("NGA", "original_id", "3.2\nindicator_id:injected");
    let obs2 = sample_observation("NGA", "injected", "3.2");
    obs1.known_at = obs2.known_at;
    obs1.published_at = obs2.published_at;

    let hash1 = hash_observation(&obs1).unwrap();
    let hash2 = hash_observation(&obs2).unwrap();
    assert_ne!(hash1, hash2);
}

#[test]
fn test_merkle_tree_rejects_duplicate_leaves() {
    let leaf = MerkleTree::hash_leaf(b"leaf_data");
    let err = MerkleTree::new(vec![leaf, leaf]).unwrap_err();
    assert!(matches!(err, EngineError::DuplicateLeaf));
}

#[test]
fn test_merkle_tree_golden_vectors() {
    let leaves_0: Vec<[u8; 32]> = vec![];
    let tree_0 = MerkleTree::new(leaves_0).unwrap();
    assert_eq!(
        hex::encode(tree_0.root()),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );

    let leaves_1: Vec<[u8; 32]> = (0..1)
        .map(|i| MerkleTree::hash_leaf(format!("leaf-{}", i).as_bytes()))
        .collect();
    let tree_1 = MerkleTree::new(leaves_1).unwrap();
    assert_eq!(
        hex::encode(tree_1.root()),
        "305df59f9590c3c9ac63d2b2743c388e3792449078cebf7fb3dbe6471643b2b7"
    );

    let leaves_2: Vec<[u8; 32]> = (0..2)
        .map(|i| MerkleTree::hash_leaf(format!("leaf-{}", i).as_bytes()))
        .collect();
    let tree_2 = MerkleTree::new(leaves_2).unwrap();
    assert_eq!(
        hex::encode(tree_2.root()),
        "60a53eed0de87a90c8e59427c59c46253c33a76a09502a51801300927b7e6bdc"
    );

    let leaves_3: Vec<[u8; 32]> = (0..3)
        .map(|i| MerkleTree::hash_leaf(format!("leaf-{}", i).as_bytes()))
        .collect();
    let tree_3 = MerkleTree::new(leaves_3).unwrap();
    assert_eq!(
        hex::encode(tree_3.root()),
        "cf763a041c81ceef1578a6083f75c61bef2e0014f2a3e683a97fcfca5be7f19a"
    );

    let leaves_5: Vec<[u8; 32]> = (0..5)
        .map(|i| MerkleTree::hash_leaf(format!("leaf-{}", i).as_bytes()))
        .collect();
    let tree_5 = MerkleTree::new(leaves_5).unwrap();
    assert_eq!(
        hex::encode(tree_5.root()),
        "82eaddbb9f384c0dca74025f5e878d385caefae7f3b9c4fc8d11580b1a418b6f"
    );
}

#[test]
fn test_merkle_tree_proof_generation_and_verification() {
    let obs_list = [
        sample_observation("NGA", "gdp_real_growth_yoy", "3.2"),
        sample_observation("USA", "gdp_real_growth_yoy", "2.1"),
        sample_observation("CHN", "gdp_real_growth_yoy", "5.0"),
        sample_observation("IND", "gdp_real_growth_yoy", "6.8"),
    ];

    let leaves: Vec<[u8; 32]> = obs_list
        .iter()
        .map(|o| hash_observation(o).unwrap())
        .collect();
    let tree = MerkleTree::new(leaves.clone()).unwrap();
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
