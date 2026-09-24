use crate::error::OracleError;
use crate::oracle::{BondVault, ClaimManager};
use crate::types::EpochSettlementClaim;
use chrono::Utc;

pub struct CrankService;

impl CrankService {
    pub fn advance_claim(
        claim: &mut EpochSettlementClaim,
        vault: &mut BondVault,
    ) -> Result<bool, OracleError> {
        let now = Utc::now();
        let settled = ClaimManager::check_and_settle(claim, now)?;
        if settled {
            vault.reward_proposer(&claim.proposer, claim.bond);
        }
        Ok(settled)
    }
}
