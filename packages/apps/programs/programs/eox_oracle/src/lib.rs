pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("GFZe6fv5iVwJ772JKVhYMWP4mMgHBzoCdcR2Z5QY5DCf");

#[program]
pub mod eox_oracle {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        arbiter: Pubkey,
        proposers: Vec<Pubkey>,
    ) -> Result<()> {
        crate::instructions::initialize::handle_initialize(ctx, arbiter, proposers)
    }

    pub fn open_epoch(ctx: Context<OpenEpoch>, year: u16, bond: u64) -> Result<()> {
        crate::instructions::open_epoch::handle_open_epoch(ctx, year, bond)
    }

    pub fn propose(ctx: Context<Propose>, args: ProposeArgs) -> Result<()> {
        crate::instructions::propose::handle_propose(ctx, args)
    }

    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        crate::instructions::settle::handle_settle(ctx)
    }

    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        crate::instructions::withdraw::handle_withdraw(ctx)
    }
}
