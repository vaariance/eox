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
            vault.payout_settlement(&claim.proposer, claim.bond, None, 0, &claim.status)?;
        }
        Ok(settled)
    }
}
