use anchor_lang::prelude::*;

use crate::{
    error::ErrorCode,
    state::{ClaimBody, Epoch, EpochStatus, Resolution},
};

const BURN_DIVISOR: u64 = 10;

fn credit(epoch: &mut Epoch, owner: Pubkey, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    if let Some(slot) = epoch.payouts.iter_mut().find(|p| p.owner == owner) {
        slot.amount = slot.amount.checked_add(amount).ok_or(ErrorCode::Overflow)?;
        return Ok(());
    }
    let slot = epoch
        .payouts
        .iter_mut()
        .find(|p| p.owner == Pubkey::default())
        .ok_or(ErrorCode::TooManyParties)?;
    slot.owner = owner;
    slot.amount = amount;
    Ok(())
}

fn award(epoch: &mut Epoch, winner: Pubkey, winner_bond: u64, loser_bond: u64) -> Result<()> {
    let burn = loser_bond / BURN_DIVISOR;
    let winnings = winner_bond
        .checked_add(loser_bond - burn)
        .ok_or(ErrorCode::Overflow)?;
    credit(epoch, winner, winnings)?;
    epoch.burn_owed = epoch.burn_owed.checked_add(burn).ok_or(ErrorCode::Overflow)?;
    Ok(())
}

// The first dispute only resets the claim, so its bonds are held until the epoch resolves.
// If the final result is the first proposal, the first proposer was right; otherwise the
// first disputer was.
fn resolve_round_one(epoch: &mut Epoch, final_output_hash: [u8; 32]) -> Result<()> {
    let (Some(proposal), Some(dispute)) = (epoch.proposals[0], epoch.disputes[0]) else {
        return Ok(());
    };
    if final_output_hash == proposal.body.output_hash {
        award(epoch, proposal.proposer, proposal.bond, dispute.bond)
    } else {
        award(epoch, dispute.disputer, dispute.bond, proposal.bond)
    }
}

fn refund_all(epoch: &mut Epoch) -> Result<()> {
    for proposal in epoch.proposals.into_iter().flatten() {
        credit(epoch, proposal.proposer, proposal.bond)?;
    }
    for dispute in epoch.disputes.into_iter().flatten() {
        credit(epoch, dispute.disputer, dispute.bond)?;
    }
    Ok(())
}

fn conclude(epoch: &mut Epoch, result: ClaimBody) -> Result<()> {
    resolve_round_one(epoch, result.output_hash)?;
    epoch.result = Some(result);
    epoch.status = EpochStatus::Settled;
    Ok(())
}

pub fn settle_undisputed(epoch: &mut Epoch) -> Result<()> {
    let last = usize::from(epoch.round).checked_sub(1).ok_or(ErrorCode::InvalidEpochStatus)?;
    let proposal = epoch.proposals[last].ok_or(ErrorCode::InvalidEpochStatus)?;
    credit(epoch, proposal.proposer, proposal.bond)?;
    conclude(epoch, proposal.body)
}

pub fn settle_arbitrated(epoch: &mut Epoch, resolution: Resolution) -> Result<()> {
    let (Some(proposal), Some(dispute)) = (epoch.proposals[1], epoch.disputes[1]) else {
        return err!(ErrorCode::InvalidEpochStatus);
    };
    match resolution {
        Resolution::ProposalWins => {
            award(epoch, proposal.proposer, proposal.bond, dispute.bond)?;
            conclude(epoch, proposal.body)
        }
        Resolution::DisputerWins => {
            award(epoch, dispute.disputer, dispute.bond, proposal.bond)?;
            conclude(epoch, dispute.candidate)
        }
        Resolution::Void => void(epoch),
    }
}

pub fn void(epoch: &mut Epoch) -> Result<()> {
    refund_all(epoch)?;
    epoch.status = EpochStatus::Voided;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{Dispute, GroundsKind, Proposal};

    const B: u64 = 1_000;

    fn key(n: u8) -> Pubkey {
        Pubkey::new_from_array([n; 32])
    }

    fn body(n: u8) -> ClaimBody {
        ClaimBody {
            evidence_root: [1; 32],
            methodology_image_id: [2; 32],
            output_hash: [n; 32],
            resolution_uri_hash: [4; 32],
        }
    }

    fn proposal(n: u8, proposer: Pubkey, bond: u64) -> Option<Proposal> {
        Some(Proposal { body: body(n), proposer, bond, proposed_at: 0 })
    }

    fn dispute(n: u8, disputer: Pubkey, bond: u64) -> Option<Dispute> {
        Some(Dispute {
            candidate: body(n),
            disputer,
            bond,
            disputed_at: 0,
            grounds: GroundsKind::Computation,
            disputed_leaf: [0; 32],
            correction: [0; 32],
        })
    }

    fn deposited(epoch: &Epoch) -> u64 {
        let proposals: u64 = epoch.proposals.iter().flatten().map(|p| p.bond).sum();
        let disputes: u64 = epoch.disputes.iter().flatten().map(|d| d.bond).sum();
        proposals + disputes
    }

    fn paid(epoch: &Epoch) -> u64 {
        epoch.payouts.iter().map(|p| p.amount).sum::<u64>() + epoch.burn_owed
    }

    fn payout_of(epoch: &Epoch, owner: Pubkey) -> u64 {
        epoch.payouts.iter().find(|p| p.owner == owner).map_or(0, |p| p.amount)
    }

    fn fresh() -> Epoch {
        Epoch::new(2025, 0, B, [2; 32], 255)
    }

    fn undisputed_first_round() -> Epoch {
        let mut e = fresh();
        e.round = 1;
        e.proposals[0] = proposal(10, key(1), B);
        e
    }

    fn after_reset(final_first: u8) -> Epoch {
        let mut e = undisputed_first_round();
        e.disputes[0] = dispute(20, key(2), B);
        e.round = 2;
        e.proposals[1] = proposal(final_first, key(3), 2 * B);
        e
    }

    fn escalated() -> Epoch {
        let mut e = after_reset(10);
        e.disputes[1] = dispute(30, key(4), 2 * B);
        e
    }

    #[test]
    fn an_undisputed_first_claim_returns_its_bond() {
        let mut e = undisputed_first_round();
        settle_undisputed(&mut e).unwrap();
        assert_eq!(payout_of(&e, key(1)), B);
        assert_eq!(e.burn_owed, 0);
        assert_eq!(e.status, EpochStatus::Settled);
        assert_eq!(e.result, Some(body(10)));
    }

    #[test]
    fn re_proposing_the_first_result_makes_the_first_proposer_right() {
        let mut e = after_reset(10);
        settle_undisputed(&mut e).unwrap();
        assert_eq!(payout_of(&e, key(1)), B + B - B / 10);
        assert_eq!(payout_of(&e, key(2)), 0);
        assert_eq!(payout_of(&e, key(3)), 2 * B);
        assert_eq!(e.burn_owed, B / 10);
        assert_eq!(paid(&e), deposited(&e));
    }

    #[test]
    fn re_proposing_a_different_result_makes_the_first_disputer_right() {
        let mut e = after_reset(20);
        settle_undisputed(&mut e).unwrap();
        assert_eq!(payout_of(&e, key(1)), 0);
        assert_eq!(payout_of(&e, key(2)), B + B - B / 10);
        assert_eq!(payout_of(&e, key(3)), 2 * B);
        assert_eq!(paid(&e), deposited(&e));
    }

    #[test]
    fn arbiter_backing_the_proposal_pays_the_proposer_the_disputers_bond() {
        let mut e = escalated();
        settle_arbitrated(&mut e, Resolution::ProposalWins).unwrap();
        assert_eq!(payout_of(&e, key(3)), 2 * B + 2 * B - 2 * B / 10);
        assert_eq!(payout_of(&e, key(4)), 0);
        assert_eq!(e.result, Some(body(10)));
        assert_eq!(payout_of(&e, key(1)), B + B - B / 10);
        assert_eq!(e.burn_owed, 2 * B / 10 + B / 10);
        assert_eq!(paid(&e), deposited(&e));
    }

    #[test]
    fn arbiter_backing_the_disputer_pays_the_disputer_the_proposers_bond() {
        let mut e = escalated();
        settle_arbitrated(&mut e, Resolution::DisputerWins).unwrap();
        assert_eq!(payout_of(&e, key(4)), 2 * B + 2 * B - 2 * B / 10);
        assert_eq!(payout_of(&e, key(3)), 0);
        assert_eq!(e.result, Some(body(30)));
        assert_eq!(payout_of(&e, key(2)), B + B - B / 10);
        assert_eq!(payout_of(&e, key(1)), 0);
        assert_eq!(paid(&e), deposited(&e));
    }

    #[test]
    fn voiding_returns_every_bond_and_burns_nothing() {
        let mut e = escalated();
        settle_arbitrated(&mut e, Resolution::Void).unwrap();
        assert_eq!(payout_of(&e, key(1)), B);
        assert_eq!(payout_of(&e, key(2)), B);
        assert_eq!(payout_of(&e, key(3)), 2 * B);
        assert_eq!(payout_of(&e, key(4)), 2 * B);
        assert_eq!(e.burn_owed, 0);
        assert_eq!(e.status, EpochStatus::Voided);
        assert_eq!(e.result, None);
    }

    #[test]
    fn one_wallet_playing_two_roles_is_paid_once() {
        let mut e = after_reset(10);
        e.proposals[1] = proposal(10, key(1), 2 * B);
        settle_undisputed(&mut e).unwrap();
        assert_eq!(payout_of(&e, key(1)), 2 * B + B + B - B / 10);
        assert_eq!(e.payouts.iter().filter(|p| p.owner == key(1)).count(), 1);
        assert_eq!(paid(&e), deposited(&e));
    }

    #[test]
    fn rounding_never_creates_or_loses_value() {
        for bond in [1u64, 9, 10, 11, 99, 1_234_567] {
            let mut e = Epoch::new(2025, 0, bond, [2; 32], 255);
            e.round = 2;
            e.proposals[0] = proposal(10, key(1), bond);
            e.disputes[0] = dispute(20, key(2), bond);
            e.proposals[1] = proposal(10, key(3), 2 * bond);
            e.disputes[1] = dispute(30, key(4), 2 * bond);
            settle_arbitrated(&mut e, Resolution::DisputerWins).unwrap();
            assert_eq!(paid(&e), deposited(&e), "bond {bond}");
        }
    }
}
