use crate::error::OracleError;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Default)]
pub struct BondVault {
    balances: BTreeMap<String, u64>,
    burned_total: u64,
    security_ratio_numerator: u64,
    security_ratio_denominator: u64,
}

impl BondVault {
    pub fn new(security_ratio_num: u64, security_ratio_den: u64) -> Self {
        Self {
            balances: BTreeMap::new(),
            burned_total: 0,
            security_ratio_numerator: security_ratio_num,
            security_ratio_denominator: security_ratio_den,
        }
    }

    pub fn max_epoch_tvl(&self, effective_bond: u64) -> u64 {
        (effective_bond * self.security_ratio_numerator) / self.security_ratio_denominator
    }

    pub fn check_deposit_limit(
        &self,
        current_tvl: u64,
        deposit_amount: u64,
        effective_bond: u64,
    ) -> Result<(), OracleError> {
        let cap = self.max_epoch_tvl(effective_bond);
        if current_tvl + deposit_amount > cap {
            Err(OracleError::MaxTvlExceeded {
                cap,
                attempted: current_tvl + deposit_amount,
            })
        } else {
            Ok(())
        }
    }

    pub fn reward_disputer(
        &mut self,
        disputer: &str,
        proposer_bond: u64,
        disputer_bond: u64,
    ) {
        let burn_amount = proposer_bond / 10;
        let disputer_reward = proposer_bond - burn_amount;
        let total_credit = disputer_bond + disputer_reward;

        self.burned_total += burn_amount;
        *self.balances.entry(disputer.to_string()).or_insert(0) += total_credit;
    }

    pub fn reward_proposer(&mut self, proposer: &str, proposer_bond: u64) {
        *self.balances.entry(proposer.to_string()).or_insert(0) += proposer_bond;
    }

    pub fn withdraw(&mut self, recipient: &str) -> u64 {
        if let Some(entry) = self.balances.get_mut(recipient) {
            let amount = *entry;
            *entry = 0;
            amount
        } else {
            0
        }
    }

    pub fn get_balance(&self, recipient: &str) -> u64 {
        self.balances.get(recipient).copied().unwrap_or(0)
    }

    pub fn get_burned_total(&self) -> u64 {
        self.burned_total
    }
}
