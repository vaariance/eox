use crate::error::OracleError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Resolution {
    CandidateA,
    CandidateB,
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
        votes: &[(String, Resolution)],
        _candidate_a: [u8; 32],
        _candidate_b: [u8; 32],
    ) -> Result<Resolution, OracleError> {
        if self.panel_members.is_empty() {
            return Err(OracleError::ArbitrationFailed("Panel is empty".to_string()));
        }

        let mut a_count = 0;
        let mut b_count = 0;
        let mut void_count = 0;

        for (member, vote) in votes {
            if self.panel_members.contains(member) {
                match vote {
                    Resolution::CandidateA => a_count += 1,
                    Resolution::CandidateB => b_count += 1,
                    Resolution::Void => void_count += 1,
                }
            }
        }

        let total_valid_votes = a_count + b_count + void_count;
        let majority = (self.panel_members.len() / 2) + 1;

        if a_count >= majority {
            Ok(Resolution::CandidateA)
        } else if b_count >= majority {
            Ok(Resolution::CandidateB)
        } else if void_count >= majority {
            Ok(Resolution::Void)
        } else if total_valid_votes == self.panel_members.len() {
            Ok(Resolution::Void)
        } else {
            Err(OracleError::ArbitrationFailed(
                "Quorum not reached".to_string(),
            ))
        }
    }
}
