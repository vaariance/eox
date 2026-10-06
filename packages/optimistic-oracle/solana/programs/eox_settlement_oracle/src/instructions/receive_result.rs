use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ErrorCode,
    relay,
    state::{ClaimBody, Config, Epoch, EpochStatus},
};

#[derive(Accounts)]
pub struct ReceiveResult<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [EPOCH_SEED, &epoch.year.to_le_bytes()], bump = epoch.bump)]
    pub epoch: Box<Account<'info, Epoch>>,
    /// CHECK: a VAA the Wormhole core bridge verified and posted. Its owner is checked here;
    /// its prefix, emitter and payload in the handler.
    #[account(owner = config.wormhole_program @ ErrorCode::NotAVerifiedVaa)]
    pub posted_vaa: UncheckedAccount<'info>,
}

#[event]
pub struct ResultReceived {
    pub year: u16,
    pub result: ClaimBody,
    pub assertion_id: [u8; 32],
    pub wormhole_sequence: u64,
}

/// Records the result UMA settled for an epoch, as relayed by the EVM adapter. Anyone may
/// submit it once the VAA is posted; the epoch takes one result only.
pub fn handle_receive_result(ctx: Context<ReceiveResult>) -> Result<()> {
    let config = &ctx.accounts.config;
    let epoch = &mut ctx.accounts.epoch;
    require!(epoch.status == EpochStatus::Open, ErrorCode::InvalidEpochStatus);
    let now = Clock::get()?.unix_timestamp;
    require!(now >= epoch.cutoff, ErrorCode::TooEarly);
    require!(now <= epoch.cutoff + RESULT_DEADLINE, ErrorCode::ResultDeadlinePassed);

    let data = ctx.accounts.posted_vaa.try_borrow_data()?;
    let vaa = relay::parse_posted_vaa(&data).ok_or(ErrorCode::NotAVerifiedVaa)?;
    require!(
        vaa.emitter_chain == config.emitter_chain && vaa.emitter_address == config.emitter_address,
        ErrorCode::UnknownEmitter
    );
    let result = relay::parse_result(vaa.payload).ok_or(ErrorCode::MalformedPayload)?;
    require!(result.year == epoch.year, ErrorCode::WrongEpoch);
    require!(
        result.body.methodology_image_id == epoch.methodology_image_id,
        ErrorCode::WrongMethodology
    );

    epoch.status = EpochStatus::Settled;
    epoch.result = Some(result.body);
    epoch.assertion_id = result.assertion_id;
    epoch.wormhole_sequence = vaa.sequence;
    emit!(ResultReceived {
        year: epoch.year,
        result: result.body,
        assertion_id: result.assertion_id,
        wormhole_sequence: vaa.sequence,
    });
    Ok(())
}
