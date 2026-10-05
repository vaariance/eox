//! The bots' view of the settlement program: read an epoch, read the clock, send an
//! instruction. `RpcChain` talks to a real cluster; tests implement `Chain` over LiteSVM.

pub mod instructions;
pub mod rpc;

use anchor_lang::{prelude::Pubkey, solana_program::instruction::Instruction, AccountDeserialize};
use eox_settlement_oracle::{
    constants::{CONFIG_SEED, EPOCH_SEED, VAULT_SEED},
    state::{Config, Epoch},
};
use solana_keypair::Keypair;

use crate::error::OracleError;

pub use rpc::RpcChain;

pub trait Chain {
    /// The cluster's clock, which is what the program checks deadlines against.
    fn now(&self) -> Result<i64, OracleError>;
    fn account_data(&self, address: &Pubkey) -> Result<Option<Vec<u8>>, OracleError>;
    /// Sends one instruction signed and paid for by `signer`, returning the signature.
    fn send(&mut self, instruction: Instruction, signer: &Keypair) -> Result<String, OracleError>;

    fn config(&self) -> Result<Config, OracleError> {
        let data = self
            .account_data(&config_address())?
            .ok_or_else(|| OracleError::Chain("the settlement program is not initialized".into()))?;
        decode(&data)
    }

    fn epoch(&self, year: u16) -> Result<Option<Epoch>, OracleError> {
        self.account_data(&epoch_address(year))?
            .map(|data| decode(&data))
            .transpose()
    }
}

fn decode<T: AccountDeserialize>(data: &[u8]) -> Result<T, OracleError> {
    T::try_deserialize(&mut &data[..]).map_err(|e| OracleError::Chain(e.to_string()))
}

fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &eox_settlement_oracle::ID).0
}

pub fn config_address() -> Pubkey {
    pda(&[CONFIG_SEED])
}

pub fn vault_address() -> Pubkey {
    pda(&[VAULT_SEED])
}

pub fn epoch_address(year: u16) -> Pubkey {
    pda(&[EPOCH_SEED, &year.to_le_bytes()])
}

/// The wallet's associated token account for the bond mint, where bots hold their bonds.
pub fn bond_account(wallet: &Pubkey, bond_mint: &Pubkey) -> Pubkey {
    anchor_spl::associated_token::get_associated_token_address(wallet, bond_mint)
}

/// The label the engine writes into the output bundle. Every bot must use the same one, or
/// honest parties compute different output hashes for the same evidence.
pub fn epoch_label(year: u16) -> String {
    format!("epoch_{year}")
}
