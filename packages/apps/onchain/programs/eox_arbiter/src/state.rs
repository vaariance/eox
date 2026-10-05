use anchor_lang::prelude::*;
use eox_settlement_oracle::state::Resolution;

use crate::constants::{MAJORITY, PANEL_SIZE};

#[account]
#[derive(InitSpace)]
pub struct Panel {
    pub authority: Pubkey,
    pub bond_mint: Pubkey,
    pub members: [Pubkey; PANEL_SIZE],
    pub bonded: [bool; PANEL_SIZE],
    pub member_bond: u64,
    pub bump: u8,
    pub authority_bump: u8,
}

impl Panel {
    pub fn seat_of(&self, member: &Pubkey) -> Option<usize> {
        self.members.iter().position(|m| m == member)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct Vote {
    pub choice: Resolution,
    pub rationale_hash: [u8; 32],
    pub voted_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct Case {
    pub year: u16,
    pub votes: [Option<Vote>; PANEL_SIZE],
    pub decided: bool,
    pub bump: u8,
}

impl Case {
    /// A choice backed by a majority wins. If every member has voted and none has a majority,
    /// the panel cannot agree and the epoch is voided.
    pub fn decision(&self) -> Option<Resolution> {
        let cast = || self.votes.iter().flatten().map(|v| v.choice);
        [Resolution::ProposalWins, Resolution::DisputerWins, Resolution::Void]
            .into_iter()
            .find(|choice| cast().filter(|c| c == choice).count() >= MAJORITY)
            .or_else(|| (cast().count() == PANEL_SIZE).then_some(Resolution::Void))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use Resolution::*;

    fn case(votes: &[Option<Resolution>]) -> Case {
        let mut c = Case { year: 2025, votes: [None; PANEL_SIZE], decided: false, bump: 0 };
        for (seat, choice) in votes.iter().enumerate() {
            c.votes[seat] = choice.map(|choice| Vote { choice, rationale_hash: [0; 32], voted_at: 0 });
        }
        c
    }

    #[test]
    fn two_matching_votes_decide() {
        assert_eq!(case(&[Some(ProposalWins), Some(ProposalWins)]).decision(), Some(ProposalWins));
        assert_eq!(case(&[Some(DisputerWins), None, Some(DisputerWins)]).decision(), Some(DisputerWins));
        assert_eq!(case(&[Some(Void), Some(Void)]).decision(), Some(Void));
    }

    #[test]
    fn a_split_waits_for_the_third_vote() {
        assert_eq!(case(&[Some(ProposalWins), Some(DisputerWins)]).decision(), None);
        assert_eq!(case(&[Some(ProposalWins)]).decision(), None);
        assert_eq!(case(&[]).decision(), None);
    }

    #[test]
    fn a_three_way_split_voids() {
        assert_eq!(
            case(&[Some(ProposalWins), Some(DisputerWins), Some(Void)]).decision(),
            Some(Void)
        );
    }
}
