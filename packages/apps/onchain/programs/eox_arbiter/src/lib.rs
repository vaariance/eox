pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;
use eox_settlement_oracle::state::Resolution;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("6exc4JPp6UHDisTSdiYtXRCR7jb3jwNJw2SEQ2tjjeNk");

#[program]
pub mod eox_arbiter {
    use super::*;

    pub fn initialize_panel(
        ctx: Context<InitializePanel>,
        members: [Pubkey; PANEL_SIZE],
        member_bond: u64,
    ) -> Result<()> {
        crate::instructions::initialize_panel::handle_initialize_panel(ctx, members, member_bond)
    }

    pub fn post_bond(ctx: Context<PostBond>) -> Result<()> {
        crate::instructions::post_bond::handle_post_bond(ctx)
    }

    pub fn open_case(ctx: Context<OpenCase>) -> Result<()> {
        crate::instructions::open_case::handle_open_case(ctx)
    }

    pub fn vote(ctx: Context<CastVote>, choice: Resolution, rationale_hash: [u8; 32]) -> Result<()> {
        crate::instructions::vote::handle_vote(ctx, choice, rationale_hash)
    }
}
