//! Solana runs nothing on its own, so someone has to press "settle" or "void" once a
//! deadline passes, and burn the forfeited share once an epoch is over. Any wallet may.

use eox_settlement_oracle::{
    constants::{ARBITER_WINDOW, CHALLENGE_WINDOW, PROPOSAL_WINDOW},
    state::{Epoch, EpochStatus},
};
use solana_keypair::Keypair;

use crate::chain::{instructions, Chain};
use crate::error::OracleError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CrankAction {
    Settle,
    Void,
    BurnForfeit,
}

/// What the program would accept for this epoch right now, if anything. The comparisons
/// mirror the program's own, so the crank never sends a transaction that must fail.
pub fn due(epoch: &Epoch, now: i64) -> Option<CrankAction> {
    match epoch.status {
        EpochStatus::Proposed => {
            let proposal = epoch.proposals[usize::from(epoch.round).checked_sub(1)?]?;
            (now >= proposal.proposed_at + CHALLENGE_WINDOW).then_some(CrankAction::Settle)
        }
        EpochStatus::Requested => (now > epoch.cutoff + PROPOSAL_WINDOW).then_some(CrankAction::Void),
        EpochStatus::Reset => (now > epoch.reset_at + PROPOSAL_WINDOW).then_some(CrankAction::Void),
        EpochStatus::Escalated => {
            (now > epoch.escalated_at + ARBITER_WINDOW).then_some(CrankAction::Void)
        }
        EpochStatus::Settled | EpochStatus::Voided => {
            (epoch.burn_owed > 0).then_some(CrankAction::BurnForfeit)
        }
    }
}

/// Takes whatever single step is due for the epoch. Returns `None` when nothing is.
pub fn crank(
    chain: &mut impl Chain,
    year: u16,
    payer: &Keypair,
) -> Result<Option<CrankAction>, OracleError> {
    let Some(epoch) = chain.epoch(year)? else {
        return Ok(None);
    };
    let Some(action) = due(&epoch, chain.now()?) else {
        return Ok(None);
    };
    let instruction = match action {
        CrankAction::Settle => instructions::settle(year),
        CrankAction::Void => instructions::void_epoch(year),
        CrankAction::BurnForfeit => instructions::burn_forfeit(year, chain.config()?.bond_mint),
    };
    chain.send(instruction, payer)?;
    Ok(Some(action))
}
