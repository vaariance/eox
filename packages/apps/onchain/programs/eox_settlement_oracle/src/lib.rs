pub mod constants;
pub mod error;
pub mod instructions;
pub mod merkle;
pub mod settlement;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("FgEEu53fcPs7Xc1yV3BiwtKeU2eDt89yEsFY7brbLrzd");

#[program]
pub mod eox_settlement_oracle {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        arbiter: Pubkey,
        proposers: Vec<Pubkey>,
    ) -> Result<()> {
        crate::instructions::initialize::handle_initialize(ctx, arbiter, proposers)
    }

    pub fn open_epoch(
        ctx: Context<OpenEpoch>,
        year: u16,
        bond: u64,
        methodology_image_id: [u8; 32],
    ) -> Result<()> {
        crate::instructions::open_epoch::handle_open_epoch(ctx, year, bond, methodology_image_id)
    }

    pub fn propose(ctx: Context<Propose>, body: ClaimBody) -> Result<()> {
        crate::instructions::propose::handle_propose(ctx, body)
    }

    pub fn dispute(ctx: Context<DisputeClaim>, candidate: ClaimBody, grounds: Grounds) -> Result<()> {
        crate::instructions::dispute::handle_dispute(ctx, candidate, grounds)
    }

    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        crate::instructions::settle::handle_settle(ctx)
    }

    pub fn resolve_arbitration(
        ctx: Context<ResolveArbitration>,
        resolution: Resolution,
    ) -> Result<()> {
        crate::instructions::resolve_arbitration::handle_resolve_arbitration(ctx, resolution)
    }

    pub fn void_epoch(ctx: Context<VoidEpoch>) -> Result<()> {
        crate::instructions::void_epoch::handle_void_epoch(ctx)
    }

    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        crate::instructions::withdraw::handle_withdraw(ctx)
    }

    pub fn burn_forfeit(ctx: Context<BurnForfeit>) -> Result<()> {
        crate::instructions::burn_forfeit::handle_burn_forfeit(ctx)
    }
}
