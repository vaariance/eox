use anchor_lang::{
    prelude::Pubkey, solana_program::instruction::Instruction, InstructionData, ToAccountMetas,
};
use anchor_spl::token::ID as TOKEN_PROGRAM;
use eox_settlement_oracle::{accounts, instruction, state::ClaimBody, Grounds};

use super::{config_address, epoch_address, vault_address};

fn build(data: impl InstructionData, accounts: impl ToAccountMetas) -> Instruction {
    Instruction::new_with_bytes(
        eox_settlement_oracle::ID,
        &data.data(),
        accounts.to_account_metas(None),
    )
}

pub fn propose(year: u16, proposer: Pubkey, proposer_token: Pubkey, body: ClaimBody) -> Instruction {
    build(
        instruction::Propose { body },
        accounts::Propose {
            proposer,
            config: config_address(),
            epoch: epoch_address(year),
            proposer_token,
            vault: vault_address(),
            token_program: TOKEN_PROGRAM,
        },
    )
}

pub fn dispute(
    year: u16,
    disputer: Pubkey,
    disputer_token: Pubkey,
    candidate: ClaimBody,
    grounds: Grounds,
) -> Instruction {
    build(
        instruction::Dispute { candidate, grounds },
        accounts::DisputeClaim {
            disputer,
            config: config_address(),
            epoch: epoch_address(year),
            disputer_token,
            vault: vault_address(),
            token_program: TOKEN_PROGRAM,
        },
    )
}

pub fn settle(year: u16) -> Instruction {
    build(instruction::Settle {}, accounts::Settle { epoch: epoch_address(year) })
}

pub fn void_epoch(year: u16) -> Instruction {
    build(instruction::VoidEpoch {}, accounts::VoidEpoch { epoch: epoch_address(year) })
}

pub fn burn_forfeit(year: u16, bond_mint: Pubkey) -> Instruction {
    build(
        instruction::BurnForfeit {},
        accounts::BurnForfeit {
            config: config_address(),
            epoch: epoch_address(year),
            vault: vault_address(),
            bond_mint,
            token_program: TOKEN_PROGRAM,
        },
    )
}

pub fn withdraw(year: u16, owner: Pubkey, destination: Pubkey) -> Instruction {
    build(
        instruction::Withdraw {},
        accounts::Withdraw {
            owner,
            config: config_address(),
            epoch: epoch_address(year),
            vault: vault_address(),
            destination,
            token_program: TOKEN_PROGRAM,
        },
    )
}
