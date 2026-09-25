use crate::error::OracleError;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArbiterVote {
    CandidateA,
    CandidateB,
    Void,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Resolution {
    Hash([u8; 32]),
    Void,
}

pub struct PanelArbiter {
    panel_members: Vec<String>,
}

impl PanelArbiter {
    pub fn new(panel_members: Vec<String>) -> Self {
        Self { panel_members }
    }

    pub fn arbitrate(
        &self,
        votes: &[(String, ArbiterVote)],
        candidate_a: [u8; 32],
        candidate_b: [u8; 32],
    ) -> Result<Resolution, OracleError> {
        if self.panel_members.is_empty() {
            return Err(OracleError::ArbitrationFailed("Panel is empty".to_string()));
        }

        let mut member_votes = BTreeMap::new();
        for (member, vote) in votes {
            if self.panel_members.contains(member)
                && member_votes.insert(member.clone(), *vote).is_some()
            {
                return Err(OracleError::ArbitrationFailed(format!(
                    "Duplicate vote from {member}"
                )));
            }
        }

        let mut a_count = 0;
        let mut b_count = 0;
        let mut void_count = 0;

        for vote in member_votes.values() {
            match vote {
                ArbiterVote::CandidateA => a_count += 1,
                ArbiterVote::CandidateB => b_count += 1,
                ArbiterVote::Void => void_count += 1,
            }
        }

        let total_valid_votes = member_votes.len();
        let majority = (self.panel_members.len() / 2) + 1;

        if a_count >= majority {
            Ok(Resolution::Hash(candidate_a))
        } else if b_count >= majority {
            Ok(Resolution::Hash(candidate_b))
        } else if void_count >= majority || total_valid_votes == self.panel_members.len() {
            Ok(Resolution::Void)
        } else {
            Err(OracleError::ArbitrationFailed(
                "Quorum not reached".to_string(),
            ))
        }
    }
}
