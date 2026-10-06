mod common;

use {
    chrono::{TimeZone, Utc},
    common::*,
    eox_engine::{
        merkle::{canonicalize_observation, hash_observation, MerkleTree},
        types::Observation,
    },
    eox_settlement_oracle::{
        error::ErrorCode,
        merkle::ProofStep,
        state::{ClaimBody, EpochStatus, GroundsKind},
        Grounds,
    },
};

const COUNTRIES: [&str; 5] = ["CHN", "DEU", "GHA", "NGA", "USA"];
const INDICATORS: [&str; 8] = [
    "nighttime_lights",
    "ndvi_crop_health",
    "overnight_lending_rates",
    "pmi",
    "gdp_real_growth_yoy",
    "cpi_headline_yoy",
    "unemployment_rate",
    "fiscal_deficit_gdp",
];

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
        recipe_id: Some(1),
        raw_sha256: Some("ab".repeat(32)),
    }
}

struct Evidence {
    observations: Vec<Observation>,
    tree: MerkleTree,
}

impl Evidence {
    fn with_ghana_inflation(value: &str) -> Self {
        let mut observations = Vec::new();
        for (ci, country) in COUNTRIES.iter().enumerate() {
            for (ii, indicator) in INDICATORS.iter().enumerate() {
                let value = if *country == "GHA" && *indicator == "cpi_headline_yoy" {
                    value.to_string()
                } else {
                    format!("{}.{}", ci * 7 + ii, ii)
                };
                observations.push(observation(country, indicator, &value));
            }
        }
        let leaves = observations.iter().map(|o| hash_observation(o).unwrap()).collect();
        Self { tree: MerkleTree::new(leaves).unwrap(), observations }
    }

    fn root(&self) -> [u8; 32] {
        self.tree.root()
    }

    fn ghana_inflation(&self) -> &Observation {
        self.observations
            .iter()
            .find(|o| o.country_iso3 == "GHA" && o.indicator_id == "cpi_headline_yoy")
            .unwrap()
    }

    fn leaf(&self) -> [u8; 32] {
        hash_observation(self.ghana_inflation()).unwrap()
    }

    fn bytes(&self) -> Vec<u8> {
        canonicalize_observation(self.ghana_inflation()).unwrap()
    }

    fn path(&self) -> Vec<ProofStep> {
        self.tree
            .generate_proof(&self.leaf())
            .unwrap()
            .into_iter()
            .map(|s| ProofStep { is_right: s.is_right, sibling: s.sibling })
            .collect()
    }

    fn claim(&self, output: u8) -> ClaimBody {
        ClaimBody {
            evidence_root: self.root(),
            methodology_image_id: IMAGE_ID,
            output_hash: [output; 32],
            resolution_uri_hash: [4u8; 32],
        }
    }
}

struct Case {
    flow: Flow,
    claimed: Evidence,
    correct: Evidence,
}

fn proposed_with_wrong_ghana_inflation() -> Case {
    let mut flow = open_flow();
    let claimed = Evidence::with_ghana_inflation("18.9");
    let correct = Evidence::with_ghana_inflation("14.2");
    flow.env.set_time(cutoff() + 3600);
    flow.env.propose(YEAR, &flow.p1, claimed.claim(10)).unwrap();
    Case { flow, claimed, correct }
}

fn wrong_observation(case: &Case, correction: Option<[u8; 32]>) -> Grounds {
    Grounds::WrongObservation {
        observation: case.claimed.bytes(),
        path: case.claimed.path(),
        correction,
    }
}

#[test]
fn a_dispute_pins_the_exact_observation_it_says_is_wrong() {
    let mut c = proposed_with_wrong_ghana_inflation();
    let grounds = wrong_observation(&c, Some(c.correct.leaf()));
    c.flow
        .env
        .dispute_on(YEAR, &c.flow.d1, c.correct.claim(20), grounds)
        .unwrap();

    let epoch = c.flow.env.epoch(YEAR);
    let dispute = epoch.disputes[0].unwrap();
    assert_eq!(epoch.status, EpochStatus::Reset);
    assert_eq!(dispute.grounds, GroundsKind::WrongObservation);
    assert_eq!(dispute.disputed_leaf, c.claimed.leaf());
    assert_eq!(dispute.correction, c.correct.leaf());
}

#[test]
fn the_dispute_fits_in_a_single_solana_transaction() {
    let c = proposed_with_wrong_ghana_inflation();
    let grounds = wrong_observation(&c, Some(c.correct.leaf()));
    let instruction = c
        .flow
        .env
        .dispute_instruction(YEAR, &c.flow.d1, c.correct.claim(20), grounds);
    let bytes = c.flow.env.transaction_bytes(instruction, &c.flow.d1.wallet);
    assert!(
        bytes <= MAX_TRANSACTION_BYTES,
        "dispute transaction is {bytes} bytes"
    );
}

#[test]
fn an_observation_that_is_not_in_the_claim_is_rejected() {
    let mut c = proposed_with_wrong_ghana_inflation();
    let grounds = Grounds::WrongObservation {
        observation: c.correct.bytes(),
        path: c.correct.path(),
        correction: None,
    };
    assert_error(
        c.flow.env.dispute_on(YEAR, &c.flow.d1, c.correct.claim(20), grounds),
        ErrorCode::ObservationNotInClaim,
    );
}

#[test]
fn a_tampered_proof_is_rejected() {
    let mut c = proposed_with_wrong_ghana_inflation();
    let mut path = c.claimed.path();
    path[2].sibling[7] ^= 1;
    let grounds = Grounds::WrongObservation {
        observation: c.claimed.bytes(),
        path,
        correction: Some(c.correct.leaf()),
    };
    assert_error(
        c.flow.env.dispute_on(YEAR, &c.flow.d1, c.correct.claim(20), grounds),
        ErrorCode::ObservationNotInClaim,
    );
}

#[test]
fn asking_to_drop_an_observation_needs_no_correction() {
    let mut c = proposed_with_wrong_ghana_inflation();
    let grounds = wrong_observation(&c, None);
    c.flow
        .env
        .dispute_on(YEAR, &c.flow.d1, c.correct.claim(20), grounds)
        .unwrap();
    assert_eq!(c.flow.env.epoch(YEAR).disputes[0].unwrap().correction, [0u8; 32]);
}

#[test]
fn a_correction_identical_to_the_disputed_observation_is_rejected() {
    let mut c = proposed_with_wrong_ghana_inflation();
    let grounds = wrong_observation(&c, Some(c.claimed.leaf()));
    assert_error(
        c.flow.env.dispute_on(YEAR, &c.flow.d1, c.correct.claim(20), grounds),
        ErrorCode::NoDisagreement,
    );
}

#[test]
fn a_data_dispute_must_come_with_different_evidence() {
    let mut c = proposed_with_wrong_ghana_inflation();
    let same_evidence = c.claimed.claim(20);

    let grounds = wrong_observation(&c, Some(c.correct.leaf()));
    assert_error(
        c.flow.env.dispute_on(YEAR, &c.flow.d1, same_evidence, grounds),
        ErrorCode::GroundsMismatch,
    );
    assert_error(
        c.flow.env.dispute_on(
            YEAR,
            &c.flow.d1,
            same_evidence,
            Grounds::MissingObservation { correction: c.correct.leaf() },
        ),
        ErrorCode::GroundsMismatch,
    );
}

#[test]
fn a_missing_observation_dispute_is_recorded_for_the_arbiter() {
    let mut c = proposed_with_wrong_ghana_inflation();
    c.flow
        .env
        .dispute_on(
            YEAR,
            &c.flow.d1,
            c.correct.claim(20),
            Grounds::MissingObservation { correction: c.correct.leaf() },
        )
        .unwrap();

    let dispute = c.flow.env.epoch(YEAR).disputes[0].unwrap();
    assert_eq!(dispute.grounds, GroundsKind::MissingObservation);
    assert_eq!(dispute.correction, c.correct.leaf());
}

#[test]
fn a_computation_dispute_must_keep_the_same_evidence() {
    let mut c = proposed_with_wrong_ghana_inflation();
    assert_error(
        c.flow
            .env
            .dispute_on(YEAR, &c.flow.d1, c.correct.claim(20), Grounds::Computation),
        ErrorCode::GroundsMismatch,
    );
    c.flow
        .env
        .dispute_on(YEAR, &c.flow.d1, c.claimed.claim(20), Grounds::Computation)
        .unwrap();
}

#[test]
fn an_overlong_proof_is_rejected() {
    let mut c = proposed_with_wrong_ghana_inflation();
    let grounds = Grounds::WrongObservation {
        observation: vec![0u8],
        path: vec![ProofStep { is_right: false, sibling: [0u8; 32] }; 17],
        correction: None,
    };
    assert_error(
        c.flow.env.dispute_on(YEAR, &c.flow.d1, c.correct.claim(20), grounds),
        ErrorCode::ProofTooLong,
    );
}

#[test]
fn a_claim_must_use_the_epochs_methodology() {
    let mut flow = open_flow();
    let evidence = Evidence::with_ghana_inflation("14.2");
    let mut claim = evidence.claim(10);
    claim.methodology_image_id = [9u8; 32];
    flow.env.set_time(cutoff() + 3600);
    assert_error(
        flow.env.propose(YEAR, &flow.p1, claim),
        ErrorCode::WrongMethodology,
    );
}

#[test]
fn a_dispute_must_use_the_epochs_methodology() {
    let mut c = proposed_with_wrong_ghana_inflation();
    let mut candidate = c.claimed.claim(20);
    candidate.methodology_image_id = [9u8; 32];
    assert_error(
        c.flow.env.dispute_on(YEAR, &c.flow.d1, candidate, Grounds::Computation),
        ErrorCode::WrongMethodology,
    );
}
