pub mod constants;
pub mod error;
pub mod instructions;
pub mod relay;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("DDReyVxqqL3AtC8D6qpbnotZK1c8WBTN2nPdx1WtPHMt");

#[program]
pub mod eox_settlement_oracle {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        wormhole_program: Pubkey,
        emitter_chain: u16,
        emitter_address: [u8; 32],
    ) -> Result<()> {
        crate::instructions::initialize::handle_initialize(ctx, wormhole_program, emitter_chain, emitter_address)
    }

    pub fn open_epoch(ctx: Context<OpenEpoch>, year: u16, methodology_image_id: [u8; 32]) -> Result<()> {
        crate::instructions::open_epoch::handle_open_epoch(ctx, year, methodology_image_id)
    }

    pub fn receive_result(ctx: Context<ReceiveResult>) -> Result<()> {
        crate::instructions::receive_result::handle_receive_result(ctx)
    }

    pub fn void_epoch(ctx: Context<VoidEpoch>) -> Result<()> {
        crate::instructions::void_epoch::handle_void_epoch(ctx)
    }
}
