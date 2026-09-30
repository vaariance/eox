#![allow(dead_code)]

use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{
            instruction::Instruction, program_option::COption, program_pack::Pack, system_program,
        },
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::token::spl_token::{
        self,
        state::{Account as TokenAccount, AccountState, Mint},
    },
    eox_oracle::{constants::*, error::ErrorCode, instructions::ProposeArgs, state::*},
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
pub const BOND: u64 = 10_000_000_000;

pub struct TestEnv {
    pub svm: LiteSVM,
    pub authority: Keypair,
    pub proposer: Keypair,
    pub mint: Pubkey,
}

pub fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &eox_oracle::id()).0
}

pub fn config_pda() -> Pubkey {
    pda(&[CONFIG_SEED])
}

pub fn vault_pda() -> Pubkey {
    pda(&[VAULT_SEED])
}

pub fn epoch_pda(year: u16) -> Pubkey {
    pda(&[EPOCH_SEED, &year.to_le_bytes()])
}

pub fn balance_pda(owner: &Pubkey) -> Pubkey {
    pda(&[BALANCE_SEED, owner.as_ref()])
}

pub fn claim_args(output_hash: [u8; 32]) -> ProposeArgs {
    ProposeArgs {
        evidence_root: [1u8; 32],
        methodology_image_id: [2u8; 32],
        output_hash,
        resolution_uri_hash: [4u8; 32],
    }
}

pub fn assert_error(result: TxResult, expected: ErrorCode) {
    let code: u32 = expected.into();
    let err = result.expect_err("transaction should fail");
    let rendered = format!("{:?}", err.err);
    assert!(
        rendered.contains(&format!("Custom({code})")),
        "expected error {code}, got {rendered}"
    );
}

impl TestEnv {
    pub fn new() -> Self {
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!(concat!(
            env!("CARGO_TARGET_TMPDIR"),
            "/../deploy/eox_oracle.so"
        ));
        svm.add_program(eox_oracle::id(), bytes).unwrap();

        let authority = Keypair::new();
        let proposer = Keypair::new();
        svm.airdrop(&authority.pubkey(), 10_000_000_000).unwrap();
        svm.airdrop(&proposer.pubkey(), 10_000_000_000).unwrap();

        let mint = Pubkey::new_unique();
        let mut data = vec![0u8; Mint::LEN];
        Mint {
            mint_authority: COption::Some(authority.pubkey()),
            supply: 0,
            decimals: 6,
            is_initialized: true,
            freeze_authority: COption::Some(authority.pubkey()),
        }
        .pack_into_slice(&mut data);
        svm.set_account(
            mint,
            Account {
                lamports: 1_000_000_000,
                data,
                owner: spl_token::ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

        let mut env = Self {
            svm,
            authority,
            proposer,
            mint,
        };

        let ix = Instruction::new_with_bytes(
            eox_oracle::id(),
            &eox_oracle::instruction::Initialize {
                arbiter: Pubkey::new_unique(),
                proposers: vec![env.proposer.pubkey()],
            }
            .data(),
            eox_oracle::accounts::Initialize {
                authority: env.authority.pubkey(),
                config: config_pda(),
                bond_mint: env.mint,
                vault: vault_pda(),
                token_program: spl_token::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        let authority = env.authority.insecure_clone();
        env.send(ix, &authority).unwrap();
        env
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

    pub fn funded_wallet(&mut self) -> Keypair {
        let wallet = Keypair::new();
        self.svm.airdrop(&wallet.pubkey(), 10_000_000_000).unwrap();
        wallet
    }

    pub fn token_account(&mut self, owner: &Pubkey, amount: u64) -> Pubkey {
        let address = Pubkey::new_unique();
        let mut data = vec![0u8; TokenAccount::LEN];
        TokenAccount {
            mint: self.mint,
            owner: *owner,
            amount,
            delegate: COption::None,
            state: AccountState::Initialized,
            is_native: COption::None,
            delegated_amount: 0,
            close_authority: COption::None,
        }
        .pack_into_slice(&mut data);
        self.svm
            .set_account(
                address,
                Account {
                    lamports: 1_000_000_000,
                    data,
                    owner: spl_token::ID,
                    executable: false,
                    rent_epoch: 0,
                },
            )
            .unwrap();
        address
    }

    pub fn token_amount(&self, address: &Pubkey) -> u64 {
        let account = self.svm.get_account(address).unwrap();
        TokenAccount::unpack(&account.data).unwrap().amount
    }

    pub fn epoch(&self, year: u16) -> Epoch {
        let account = self.svm.get_account(&epoch_pda(year)).unwrap();
        Epoch::try_deserialize(&mut account.data.as_slice()).unwrap()
    }

    pub fn balance(&self, owner: &Pubkey) -> u64 {
        let account = self.svm.get_account(&balance_pda(owner)).unwrap();
        Balance::try_deserialize(&mut account.data.as_slice())
            .unwrap()
            .amount
    }

    pub fn open_epoch(&mut self, year: u16, bond: u64) -> TxResult {
        let ix = Instruction::new_with_bytes(
            eox_oracle::id(),
            &eox_oracle::instruction::OpenEpoch { year, bond }.data(),
            eox_oracle::accounts::OpenEpoch {
                authority: self.authority.pubkey(),
                config: config_pda(),
                epoch: epoch_pda(year),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        let authority = self.authority.insecure_clone();
        self.send(ix, &authority)
    }

    pub fn propose(
        &mut self,
        year: u16,
        proposer: &Keypair,
        proposer_token: Pubkey,
        args: ProposeArgs,
    ) -> TxResult {
        let ix = Instruction::new_with_bytes(
            eox_oracle::id(),
            &eox_oracle::instruction::Propose { args }.data(),
            eox_oracle::accounts::Propose {
                proposer: proposer.pubkey(),
                config: config_pda(),
                epoch: epoch_pda(year),
                proposer_token,
                vault: vault_pda(),
                balance: balance_pda(&proposer.pubkey()),
                token_program: spl_token::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        self.send(ix, proposer)
    }

    pub fn settle(&mut self, year: u16, proposer: &Pubkey) -> TxResult {
        let ix = Instruction::new_with_bytes(
            eox_oracle::id(),
            &eox_oracle::instruction::Settle {}.data(),
            eox_oracle::accounts::Settle {
                epoch: epoch_pda(year),
                proposer_balance: balance_pda(proposer),
            }
            .to_account_metas(None),
        );
        let cranker = self.funded_wallet();
        self.send(ix, &cranker)
    }

    pub fn withdraw(&mut self, owner: &Keypair, destination: Pubkey) -> TxResult {
        let ix = Instruction::new_with_bytes(
            eox_oracle::id(),
            &eox_oracle::instruction::Withdraw {}.data(),
            eox_oracle::accounts::Withdraw {
                owner: owner.pubkey(),
                config: config_pda(),
                balance: balance_pda(&owner.pubkey()),
                vault: vault_pda(),
                destination,
                token_program: spl_token::ID,
            }
            .to_account_metas(None),
        );
        self.send(ix, owner)
    }
}
