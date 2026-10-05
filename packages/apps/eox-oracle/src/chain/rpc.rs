use anchor_lang::{
    prelude::{Clock, Pubkey},
    solana_program::{instruction::Instruction, sysvar::SysvarId},
};
use solana_commitment_config::CommitmentConfig;
use solana_keypair::Keypair;
use solana_rpc_client::rpc_client::RpcClient;
use solana_signer::Signer;
use solana_transaction::Transaction;

use super::Chain;
use crate::error::OracleError;

/// `Clock` is laid out as slot, epoch_start_timestamp, epoch, leader_schedule_epoch,
/// unix_timestamp: five little-endian 8-byte fields.
const CLOCK_UNIX_TIMESTAMP: std::ops::Range<usize> = 32..40;

pub struct RpcChain {
    client: RpcClient,
}

impl RpcChain {
    pub fn new(url: &str) -> Self {
        Self {
            client: RpcClient::new_with_commitment(url.to_string(), CommitmentConfig::confirmed()),
        }
    }
}

fn rpc_error(e: impl std::fmt::Display) -> OracleError {
    OracleError::Chain(e.to_string())
}

impl Chain for RpcChain {
    fn now(&self) -> Result<i64, OracleError> {
        let clock = self.client.get_account_data(&Clock::id()).map_err(rpc_error)?;
        let bytes = clock
            .get(CLOCK_UNIX_TIMESTAMP)
            .ok_or_else(|| OracleError::Chain("clock sysvar is too short".into()))?;
        Ok(i64::from_le_bytes(bytes.try_into().expect("8 bytes")))
    }

    fn account_data(&self, address: &Pubkey) -> Result<Option<Vec<u8>>, OracleError> {
        let response = self
            .client
            .get_account_with_commitment(address, self.client.commitment())
            .map_err(rpc_error)?;
        Ok(response.value.map(|account| account.data))
    }

    fn send(&mut self, instruction: Instruction, signer: &Keypair) -> Result<String, OracleError> {
        let blockhash = self.client.get_latest_blockhash().map_err(rpc_error)?;
        let transaction = Transaction::new_signed_with_payer(
            &[instruction],
            Some(&signer.pubkey()),
            &[signer],
            blockhash,
        );
        let signature = self
            .client
            .send_and_confirm_transaction(&transaction)
            .map_err(rpc_error)?;
        Ok(signature.to_string())
    }
}
