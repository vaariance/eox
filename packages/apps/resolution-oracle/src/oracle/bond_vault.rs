use crate::error::OracleError;
use crate::types::ClaimStatus;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Default)]
pub struct BondVault {
    balances: BTreeMap<String, u64>,
    deposits: BTreeMap<String, u64>,
    total_deposited: u64,
    total_credited: u64,
    burned_total: u64,
    security_ratio_numerator: u64,
    security_ratio_denominator: u64,
}

impl BondVault {
    pub fn new(security_ratio_num: u64, security_ratio_den: u64) -> Result<Self, OracleError> {
        if security_ratio_den == 0 {
            return Err(OracleError::DivisionByZero);
        }
        Ok(Self {
            balances: BTreeMap::new(),
            deposits: BTreeMap::new(),
            total_deposited: 0,
            total_credited: 0,
            burned_total: 0,
            security_ratio_numerator: security_ratio_num,
            security_ratio_denominator: security_ratio_den,
        })
    }

    pub fn deposit(&mut self, depositor: &str, amount: u64) -> Result<(), OracleError> {
        let entry = self.deposits.entry(depositor.to_string()).or_insert(0);
        *entry = entry
            .checked_add(amount)
            .ok_or(OracleError::ArithmeticOverflow)?;
        self.total_deposited = self
            .total_deposited
            .checked_add(amount)
            .ok_or(OracleError::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn max_epoch_tvl(&self, effective_bond: u64) -> Result<u64, OracleError> {
        effective_bond
            .checked_mul(self.security_ratio_numerator)
            .ok_or(OracleError::ArithmeticOverflow)?
            .checked_div(self.security_ratio_denominator)
            .ok_or(OracleError::DivisionByZero)
    }

    pub fn check_deposit_limit(
        &self,
        current_tvl: u64,
        deposit_amount: u64,
        effective_bond: u64,
    ) -> Result<(), OracleError> {
        let attempted = current_tvl
            .checked_add(deposit_amount)
            .ok_or(OracleError::ArithmeticOverflow)?;
        let cap = self.max_epoch_tvl(effective_bond)?;
        if attempted > cap {
            Err(OracleError::MaxTvlExceeded { cap, attempted })
        } else {
            Ok(())
        }
    }

    fn credit_balance(&mut self, recipient: &str, amount: u64) -> Result<(), OracleError> {
        let would_credit = self
            .total_credited
            .checked_add(self.burned_total)
            .and_then(|t| t.checked_add(amount))
            .ok_or(OracleError::ArithmeticOverflow)?;
        if would_credit > self.total_deposited {
            return Err(OracleError::ArithmeticOverflow);
        }
        self.total_credited = self
            .total_credited
            .checked_add(amount)
            .ok_or(OracleError::ArithmeticOverflow)?;
        let entry = self.balances.entry(recipient.to_string()).or_insert(0);
        *entry = entry
            .checked_add(amount)
            .ok_or(OracleError::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn payout_settlement(
        &mut self,
        proposer: &str,
        proposer_bond: u64,
        disputer: Option<&str>,
        disputer_bond: u64,
        outcome: &ClaimStatus,
    ) -> Result<(), OracleError> {
        match outcome {
            ClaimStatus::SettledTrue => {
                if let Some(_d) = disputer {
                    let burn = disputer_bond
                        .checked_div(10)
                        .ok_or(OracleError::ArithmeticOverflow)?;
                    let reward = disputer_bond
                        .checked_sub(burn)
                        .ok_or(OracleError::ArithmeticOverflow)?;
                    self.burned_total = self
                        .burned_total
                        .checked_add(burn)
                        .ok_or(OracleError::ArithmeticOverflow)?;
                    let total_prop = proposer_bond
                        .checked_add(reward)
                        .ok_or(OracleError::ArithmeticOverflow)?;
                    self.credit_balance(proposer, total_prop)?;
                } else {
                    self.credit_balance(proposer, proposer_bond)?;
                }
            }
            ClaimStatus::SettledFalse => {
                if let Some(d) = disputer {
                    let burn = proposer_bond
                        .checked_div(10)
                        .ok_or(OracleError::ArithmeticOverflow)?;
                    let reward = proposer_bond
                        .checked_sub(burn)
                        .ok_or(OracleError::ArithmeticOverflow)?;
                    self.burned_total = self
                        .burned_total
                        .checked_add(burn)
                        .ok_or(OracleError::ArithmeticOverflow)?;
                    let total_disp = disputer_bond
                        .checked_add(reward)
                        .ok_or(OracleError::ArithmeticOverflow)?;
                    self.credit_balance(d, total_disp)?;
                }
            }
            ClaimStatus::Voided => {
                self.credit_balance(proposer, proposer_bond)?;
                if let Some(d) = disputer {
                    self.credit_balance(d, disputer_bond)?;
                }
            }
            _ => {
                return Err(OracleError::InvalidStateTransition {
                    from: format!("{:?}", outcome),
                    to: "Payout".to_string(),
                })
            }
        }
        Ok(())
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

    pub fn get_deposit(&self, depositor: &str) -> u64 {
        self.deposits.get(depositor).copied().unwrap_or(0)
    }

    pub fn get_burned_total(&self) -> u64 {
        self.burned_total
    }
}
