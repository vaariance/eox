#![allow(dead_code)]

use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{bpf_loader_upgradeable, instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    eox_settlement_oracle::{constants::*, error::ErrorCode, state::*},
    litesvm::{
        types::{FailedTransactionMetadata, TransactionMetadata},
        LiteSVM,
    },
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

pub type TxResult = Result<TransactionMetadata, Box<FailedTransactionMetadata>>;

pub const YEAR: u16 = 2025;
pub const IMAGE_ID: [u8; 32] = word(0x2222);
pub const BASE_CHAIN: u16 = 30;
pub const DAY: i64 = 86_400;

/// `resultPayload(2025)` from the EVM adapter's `test_golden_payload`.
pub const GOLDEN_PAYLOAD: &str = concat!(
    "454f58520107e9",
    "0000000000000000000000000000000000000000000000000000000000001111",
    "0000000000000000000000000000000000000000000000000000000000002222",
    "0000000000000000000000000000000000000000000000000000000000003333",
    "3bd078a333c9589d2d52ae40c744d98d26f14af482521bab3fff59c26fa8d4ad",
    "b10e2d527612073b26eecdfd717e6a320cf44b4afac2b0732d9fcbe2b7fa0cf6",
);

pub const fn word(tail: u16) -> [u8; 32] {
    let mut w = [0u8; 32];
    let b = tail.to_be_bytes();
    w[30] = b[0];
    w[31] = b[1];
    w
}

pub fn unhex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

/// The golden payload with its year and methodology replaced.
pub fn payload(year: u16, image_id: [u8; 32]) -> Vec<u8> {
    let mut p = unhex(GOLDEN_PAYLOAD);
    p[5..7].copy_from_slice(&year.to_be_bytes());
    p[39..71].copy_from_slice(&image_id);
    p
}

/// A posted VAA account's data, laid out as the core bridge writes it.
pub fn posted_vaa_data(magic: &[u8; 3], sequence: u64, chain: u16, emitter: [u8; 32], payload: &[u8]) -> Vec<u8> {
    let mut d = magic.to_vec();
    d.extend_from_slice(&[1, 1]); // vaa_version, consistency_level
    d.extend_from_slice(&1_785_500_000u32.to_le_bytes()); // vaa_time
    d.extend_from_slice(&[7u8; 32]); // vaa_signature_account
    d.extend_from_slice(&1_785_500_100u32.to_le_bytes()); // submission_time
    d.extend_from_slice(&0u32.to_le_bytes()); // nonce
    d.extend_from_slice(&sequence.to_le_bytes());
    d.extend_from_slice(&chain.to_le_bytes());
    d.extend_from_slice(&emitter);
    d.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    d.extend_from_slice(payload);
    d
}

pub fn cutoff() -> i64 {
    cutoff_timestamp(YEAR)
}

pub fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &eox_settlement_oracle::id()).0
}

pub fn config_pda() -> Pubkey {
    pda(&[CONFIG_SEED])
}

pub fn epoch_pda(year: u16) -> Pubkey {
    pda(&[EPOCH_SEED, &year.to_le_bytes()])
}

pub fn program_data_pda(program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[program.as_ref()], &bpf_loader_upgradeable::ID).0
}

/// LiteSVM deploys programs with no upgrade authority; this writes one in, the way a real
/// `solana program deploy` would.
pub fn set_upgrade_authority(svm: &mut LiteSVM, program: &Pubkey, authority: Option<Pubkey>) {
    let address = program_data_pda(program);
    let mut account = svm.get_account(&address).unwrap();
    // bincode UpgradeableLoaderState::ProgramData: u32 tag, u64 slot, Option<Pubkey>.
    account.data[12..45].fill(0);
    if let Some(authority) = authority {
        account.data[12] = 1;
        account.data[13..45].copy_from_slice(authority.as_ref());
    }
    svm.set_account(address, account).unwrap();
}

pub fn assert_anchor_error(result: TxResult, code: u32) {
    let err = result.expect_err("transaction should fail");
    let rendered = format!("{:?}", err.err);
    assert!(rendered.contains(&format!("Custom({code})")), "expected error {code}, got {rendered}");
}

pub fn assert_error(result: TxResult, expected: ErrorCode) {
    assert_anchor_error(result, expected.into());
}

fn ix<A: InstructionData, M: ToAccountMetas>(data: A, accounts: M) -> Instruction {
    Instruction::new_with_bytes(eox_settlement_oracle::id(), &data.data(), accounts.to_account_metas(None))
}

pub struct TestEnv {
    pub svm: LiteSVM,
    pub authority: Keypair,
    /// Stands in for the Wormhole core bridge: posted VAAs are accounts it owns.
    pub wormhole: Pubkey,
    /// The EVM adapter's address as a 32-byte Wormhole emitter.
    pub emitter: [u8; 32],
    pub payer: Keypair,
}

impl TestEnv {
    /// The program deployed with the authority as its upgrade key, not yet initialized.
    pub fn uninitialized() -> Self {
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/eox_settlement_oracle.so"));
        svm.add_program(eox_settlement_oracle::id(), bytes).unwrap();

        let authority = Keypair::new();
        let payer = Keypair::new();
        set_upgrade_authority(&mut svm, &eox_settlement_oracle::id(), Some(authority.pubkey()));
        svm.airdrop(&authority.pubkey(), 10_000_000_000).unwrap();
        svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();

        let mut emitter = [0u8; 32];
        emitter[12..].copy_from_slice(&[0xad; 20]);
        Self { svm, authority, wormhole: Pubkey::new_unique(), emitter, payer }
    }

    /// Initialized with the test Wormhole program and emitter, and epoch `YEAR` open.
    pub fn new() -> Self {
        let mut env = Self::uninitialized();
        let authority = env.authority.insecure_clone();
        let (wormhole, emitter) = (env.wormhole, env.emitter);
        env.initialize_as(&authority, wormhole, BASE_CHAIN, emitter).unwrap();
        env.open_epoch(YEAR, IMAGE_ID).unwrap();
        env
    }

    pub fn initialize_as(&mut self, signer: &Keypair, wormhole: Pubkey, chain: u16, emitter: [u8; 32]) -> TxResult {
        let program_data = program_data_pda(&eox_settlement_oracle::id());
        self.initialize_with(signer, wormhole, chain, emitter, program_data)
    }

    pub fn initialize_with(
        &mut self,
        signer: &Keypair,
        wormhole: Pubkey,
        chain: u16,
        emitter: [u8; 32],
        program_data: Pubkey,
    ) -> TxResult {
        let instruction = ix(
            eox_settlement_oracle::instruction::Initialize {
                wormhole_program: wormhole,
                emitter_chain: chain,
                emitter_address: emitter,
            },
            eox_settlement_oracle::accounts::Initialize {
                authority: signer.pubkey(),
                config: config_pda(),
                program: eox_settlement_oracle::id(),
                program_data,
                system_program: system_program::ID,
            },
        );
        self.send(instruction, signer)
    }

    pub fn open_epoch_as(&mut self, signer: &Keypair, year: u16, image_id: [u8; 32]) -> TxResult {
        let instruction = ix(
            eox_settlement_oracle::instruction::OpenEpoch { year, methodology_image_id: image_id },
            eox_settlement_oracle::accounts::OpenEpoch {
                authority: signer.pubkey(),
                config: config_pda(),
                epoch: epoch_pda(year),
                system_program: system_program::ID,
            },
        );
        self.send(instruction, signer)
    }

    pub fn open_epoch(&mut self, year: u16, image_id: [u8; 32]) -> TxResult {
        let authority = self.authority.insecure_clone();
        self.open_epoch_as(&authority, year, image_id)
    }

    pub fn post(&mut self, owner: Pubkey, data: Vec<u8>) -> Pubkey {
        let address = Pubkey::new_unique();
        let account = Account { lamports: 1_000_000_000, data, owner, executable: false, rent_epoch: 0 };
        self.svm.set_account(address, account).unwrap();
        address
    }

    /// A verified VAA from the adapter carrying `payload`.
    pub fn post_result(&mut self, sequence: u64, payload: &[u8]) -> Pubkey {
        let data = posted_vaa_data(b"vaa", sequence, BASE_CHAIN, self.emitter, payload);
        self.post(self.wormhole, data)
    }

    pub fn receive(&mut self, year: u16, posted_vaa: Pubkey) -> TxResult {
        let instruction = ix(
            eox_settlement_oracle::instruction::ReceiveResult {},
            eox_settlement_oracle::accounts::ReceiveResult {
                config: config_pda(),
                epoch: epoch_pda(year),
                posted_vaa,
            },
        );
        let payer = self.payer.insecure_clone();
        self.send(instruction, &payer)
    }

    pub fn void(&mut self, year: u16) -> TxResult {
        let instruction = ix(
            eox_settlement_oracle::instruction::VoidEpoch {},
            eox_settlement_oracle::accounts::VoidEpoch { epoch: epoch_pda(year) },
        );
        let payer = self.payer.insecure_clone();
        self.send(instruction, &payer)
    }

    pub fn send(&mut self, ix: Instruction, signer: &Keypair) -> TxResult {
        self.svm.expire_blockhash();
        let blockhash = self.svm.latest_blockhash();
        let msg = Message::new_with_blockhash(&[ix], Some(&signer.pubkey()), &blockhash);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[signer]).unwrap();
        self.svm.send_transaction(tx).map_err(Box::new)
    }

    pub fn set_time(&mut self, unix_timestamp: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp = unix_timestamp;
        self.svm.set_sysvar(&clock);
    }

    pub fn config(&self) -> Config {
        let account = self.svm.get_account(&config_pda()).unwrap();
        Config::try_deserialize(&mut account.data.as_slice()).unwrap()
    }

    pub fn epoch(&self, year: u16) -> Epoch {
        let account = self.svm.get_account(&epoch_pda(year)).unwrap();
        Epoch::try_deserialize(&mut account.data.as_slice()).unwrap()
    }
}
