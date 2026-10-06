use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    /// The Wormhole core bridge program. Verified VAAs are accounts it owns.
    pub wormhole_program: Pubkey,
    /// Wormhole chain ID of the chain the EVM adapter lives on (Base is 30).
    pub emitter_chain: u16,
    /// The EVM adapter's address, left-padded to 32 bytes, as Wormhole names emitters.
    pub emitter_address: [u8; 32],
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum EpochStatus {
    Open,
    Settled,
    Voided,
}

/// The hashes a result commits to. Matches `Claim` in the EVM adapter.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct ClaimBody {
    pub evidence_root: [u8; 32],
    pub methodology_image_id: [u8; 32],
    pub output_hash: [u8; 32],
    pub resolution_uri_hash: [u8; 32],
}

#[account]
#[derive(InitSpace)]
pub struct Epoch {
    pub year: u16,
    pub cutoff: i64,
    pub methodology_image_id: [u8; 32],
    pub status: EpochStatus,
    pub result: Option<ClaimBody>,
    /// The UMA assertion that settled the epoch.
    pub assertion_id: [u8; 32],
    /// Sequence of the Wormhole message the result arrived in.
    pub wormhole_sequence: u64,
    pub bump: u8,
}

impl Epoch {
    pub fn new(year: u16, cutoff: i64, methodology_image_id: [u8; 32], bump: u8) -> Self {
        Self {
            year,
            cutoff,
            methodology_image_id,
            status: EpochStatus::Open,
            result: None,
            assertion_id: [0; 32],
            wormhole_sequence: 0,
            bump,
        }
    }
}


/// Values the TypeScript SDK pins too (`sdk/test/solana.test.ts`), so the client and the
/// program cannot drift apart unnoticed.
#[cfg(test)]
mod sdk_vectors {
    use super::*;
    use crate::constants::*;
    use anchor_lang::{AccountSerialize, Discriminator};
    use std::str::FromStr;

    const SETTLED_2025: &str = concat!(
        "5d537859978a986c", // account discriminator
        "e907",             // year
        "80e56b6a00000000", // cutoff
        "2222222222222222222222222222222222222222222222222222222222222222",
        "01",               // status: Settled
        "01",               // result: Some
        "1111111111111111111111111111111111111111111111111111111111111111",
        "2222222222222222222222222222222222222222222222222222222222222222",
        "3333333333333333333333333333333333333333333333333333333333333333",
        "4444444444444444444444444444444444444444444444444444444444444444",
        "5555555555555555555555555555555555555555555555555555555555555555", // assertion id
        "1100000000000000", // wormhole sequence
        "ff",               // bump
    );
    const OPEN_2026: &str = concat!(
        "5d537859978a986c",
        "ea07",
        "00194d6c00000000",
        "2222222222222222222222222222222222222222222222222222222222222222",
        "00", // status: Open
        "00", // result: None
        "0000000000000000000000000000000000000000000000000000000000000000",
        "0000000000000000",
        "fe",
    );

    fn hex(b: &[u8]) -> String {
        b.iter().map(|x| format!("{x:02x}")).collect()
    }

    #[test]
    fn discriminators() {
        assert_eq!(hex(crate::instruction::Initialize::DISCRIMINATOR), "afaf6d1f0d989bed");
        assert_eq!(hex(crate::instruction::OpenEpoch::DISCRIMINATOR), "4b39da21adfecf88");
        assert_eq!(hex(crate::instruction::ReceiveResult::DISCRIMINATOR), "9372879a47abe718");
        assert_eq!(hex(crate::instruction::VoidEpoch::DISCRIMINATOR), "5449e5c9e02429cb");
        assert_eq!(hex(Epoch::DISCRIMINATOR), "5d537859978a986c");
        assert_eq!(hex(Config::DISCRIMINATOR), "9b0caae01efacc82");
    }

    #[test]
    fn addresses() {
        let config = Pubkey::find_program_address(&[CONFIG_SEED], &crate::ID).0;
        let epoch = Pubkey::find_program_address(&[EPOCH_SEED, &2025u16.to_le_bytes()], &crate::ID).0;
        assert_eq!(config, Pubkey::from_str("JDVQSVB61491BcXBGDZ5NjDd7pwNBNnveeHC49jXiwe2").unwrap());
        assert_eq!(epoch, Pubkey::from_str("5rRNd32H52xpM8FMFcc5xsqi9gYWK73whGPdnijkfZQK").unwrap());
    }

    #[test]
    fn epoch_accounts() {
        let mut settled = Epoch::new(2025, cutoff_timestamp(2025), [0x22; 32], 255);
        settled.status = EpochStatus::Settled;
        settled.result = Some(ClaimBody {
            evidence_root: [0x11; 32],
            methodology_image_id: [0x22; 32],
            output_hash: [0x33; 32],
            resolution_uri_hash: [0x44; 32],
        });
        settled.assertion_id = [0x55; 32];
        settled.wormhole_sequence = 17;
        let open = Epoch::new(2026, cutoff_timestamp(2026), [0x22; 32], 254);

        let mut data = Vec::new();
        settled.try_serialize(&mut data).unwrap();
        assert_eq!(hex(&data), SETTLED_2025);
        let mut data = Vec::new();
        open.try_serialize(&mut data).unwrap();
        assert_eq!(hex(&data), OPEN_2026);
    }
}
