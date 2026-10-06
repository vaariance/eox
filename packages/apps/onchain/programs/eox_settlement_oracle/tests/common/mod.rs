#![allow(dead_code)]

use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{
            bpf_loader_upgradeable, instruction::Instruction, program_option::COption,
            program_pack::Pack, system_program,
        },
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::token::spl_token::{
        self,
        state::{Account as TokenAccount, AccountState, Mint},
    },
    eox_settlement_oracle::{constants::*, error::ErrorCode, state::*, Grounds},
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
pub const START: u64 = 5 * BOND;
pub const MINT_SUPPLY: u64 = 1_000_000_000_000_000;
pub const IMAGE_ID: [u8; 32] = [2u8; 32];
pub const MAX_TRANSACTION_BYTES: usize = 1232;

pub fn cutoff() -> i64 {
    cutoff_timestamp(YEAR)
}

pub struct Party {
    pub wallet: Keypair,
    pub token: Pubkey,
}

impl Party {
    pub fn key(&self) -> Pubkey {
        self.wallet.pubkey()
    }
}

pub struct TestEnv {
    pub svm: LiteSVM,
    pub authority: Keypair,
    pub arbiter: Keypair,
    pub proposer: Party,
    pub second_proposer: Party,
    pub mint: Pubkey,
}

pub fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &eox_settlement_oracle::id()).0
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
    assert!(
        rendered.contains(&format!("Custom({code})")),
        "expected error {code}, got {rendered}"
    );
}

pub fn body(n: u8) -> ClaimBody {
    ClaimBody {
        evidence_root: [1u8; 32],
        methodology_image_id: IMAGE_ID,
        output_hash: [n; 32],
        resolution_uri_hash: [4u8; 32],
    }
}

pub fn assert_error(result: TxResult, expected: ErrorCode) {
    assert_anchor_error(result, expected.into());
}

fn ix<A: InstructionData, M: ToAccountMetas>(data: A, accounts: M) -> Instruction {
    Instruction::new_with_bytes(
        eox_settlement_oracle::id(),
        &data.data(),
        accounts.to_account_metas(None),
    )
}

impl TestEnv {
    /// The program deployed with the authority as its upgrade key, not yet initialized.
    pub fn uninitialized() -> Self {
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!(concat!(
            env!("CARGO_TARGET_TMPDIR"),
            "/../deploy/eox_settlement_oracle.so"
        ));
        svm.add_program(eox_settlement_oracle::id(), bytes).unwrap();

        let authority = Keypair::new();
        let arbiter = Keypair::new();
        set_upgrade_authority(&mut svm, &eox_settlement_oracle::id(), Some(authority.pubkey()));
        svm.airdrop(&authority.pubkey(), 10_000_000_000).unwrap();
        svm.airdrop(&arbiter.pubkey(), 10_000_000_000).unwrap();

        let mint = Pubkey::new_unique();
        let mut data = vec![0u8; Mint::LEN];
        Mint {
            mint_authority: COption::Some(authority.pubkey()),
            supply: MINT_SUPPLY,
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
            arbiter,
            proposer: Party { wallet: Keypair::new(), token: Pubkey::default() },
            second_proposer: Party { wallet: Keypair::new(), token: Pubkey::default() },
            mint,
        };
        env.proposer = env.fund(env.proposer.wallet.insecure_clone(), START);
        env.second_proposer = env.fund(env.second_proposer.wallet.insecure_clone(), START);

        env
    }

    /// A set-up program: the authority holds the upgrade key and has initialized it with
    /// both proposers.
    pub fn new() -> Self {
        let mut env = Self::uninitialized();
        let authority = env.authority.insecure_clone();
        let proposers = vec![env.proposer.key(), env.second_proposer.key()];
        env.initialize_as(&authority, proposers).unwrap();
        env
    }

    pub fn initialize_as(&mut self, signer: &Keypair, proposers: Vec<Pubkey>) -> TxResult {
        let program_data = program_data_pda(&eox_settlement_oracle::id());
        self.initialize_with(signer, proposers, program_data)
    }

    pub fn initialize_with(
        &mut self,
        signer: &Keypair,
        proposers: Vec<Pubkey>,
        program_data: Pubkey,
    ) -> TxResult {
        let instruction = ix(
            eox_settlement_oracle::instruction::Initialize {
                arbiter: self.arbiter.pubkey(),
                proposers,
            },
            eox_settlement_oracle::accounts::Initialize {
                authority: signer.pubkey(),
                config: config_pda(),
                bond_mint: self.mint,
                vault: vault_pda(),
                program: eox_settlement_oracle::id(),
                program_data,
                token_program: spl_token::ID,
                system_program: system_program::ID,
            },
        );
        self.send(instruction, signer)
    }

    pub fn config(&self) -> Config {
        let account = self.svm.get_account(&config_pda()).unwrap();
        Config::try_deserialize(&mut account.data.as_slice()).unwrap()
    }

    fn manage_proposers_ix<A: InstructionData>(&self, data: A, signer: &Keypair) -> Instruction {
        ix(
            data,
            eox_settlement_oracle::accounts::ManageProposers {
                authority: signer.pubkey(),
                config: config_pda(),
            },
        )
    }

    pub fn add_proposer_as(&mut self, signer: &Keypair, proposer: Pubkey) -> TxResult {
        let instruction = self
            .manage_proposers_ix(eox_settlement_oracle::instruction::AddProposer { proposer }, signer);
        self.send(instruction, signer)
    }

    pub fn add_proposer(&mut self, proposer: Pubkey) -> TxResult {
        let authority = self.authority.insecure_clone();
        self.add_proposer_as(&authority, proposer)
    }

    pub fn remove_proposer(&mut self, proposer: Pubkey) -> TxResult {
        let authority = self.authority.insecure_clone();
        let instruction = self.manage_proposers_ix(
            eox_settlement_oracle::instruction::RemoveProposer { proposer },
            &authority,
        );
        self.send(instruction, &authority)
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

    pub fn fund(&mut self, wallet: Keypair, tokens: u64) -> Party {
        self.svm.airdrop(&wallet.pubkey(), 10_000_000_000).unwrap();
        let token = self.token_account(&wallet.pubkey(), tokens);
        Party { wallet, token }
    }

    pub fn party(&mut self, tokens: u64) -> Party {
        self.fund(Keypair::new(), tokens)
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

    pub fn freeze(&mut self, address: &Pubkey) {
        let mut account = self.svm.get_account(address).unwrap();
        let mut token = TokenAccount::unpack(&account.data).unwrap();
        token.state = AccountState::Frozen;
        TokenAccount::pack(token, &mut account.data).unwrap();
        self.svm.set_account(*address, account).unwrap();
    }

    pub fn token_amount(&self, address: &Pubkey) -> u64 {
        let account = self.svm.get_account(address).unwrap();
        TokenAccount::unpack(&account.data).unwrap().amount
    }

    pub fn supply(&self) -> u64 {
        let account = self.svm.get_account(&self.mint).unwrap();
        Mint::unpack(&account.data).unwrap().supply
    }

    pub fn vault_amount(&self) -> u64 {
        self.token_amount(&vault_pda())
    }

    pub fn epoch(&self, year: u16) -> Epoch {
        let account = self.svm.get_account(&epoch_pda(year)).unwrap();
        Epoch::try_deserialize(&mut account.data.as_slice()).unwrap()
    }

    pub fn owed_to(&self, year: u16, owner: &Pubkey) -> u64 {
        self.epoch(year)
            .payouts
            .iter()
            .find(|p| p.owner == *owner)
            .map_or(0, |p| p.amount)
    }

    pub fn open_epoch(&mut self, year: u16, bond: u64) -> TxResult {
        let instruction = ix(
            eox_settlement_oracle::instruction::OpenEpoch {
                year,
                bond,
                methodology_image_id: IMAGE_ID,
            },
            eox_settlement_oracle::accounts::OpenEpoch {
                authority: self.authority.pubkey(),
                config: config_pda(),
                epoch: epoch_pda(year),
                system_program: system_program::ID,
            },
        );
        let authority = self.authority.insecure_clone();
        self.send(instruction, &authority)
    }

    pub fn propose(&mut self, year: u16, proposer: &Party, body: ClaimBody) -> TxResult {
        let instruction = ix(
            eox_settlement_oracle::instruction::Propose { body },
            eox_settlement_oracle::accounts::Propose {
                proposer: proposer.key(),
                config: config_pda(),
                epoch: epoch_pda(year),
                proposer_token: proposer.token,
                vault: vault_pda(),
                token_program: spl_token::ID,
            },
        );
        self.send(instruction, &proposer.wallet)
    }

    pub fn dispute(&mut self, year: u16, disputer: &Party, candidate: ClaimBody) -> TxResult {
        self.dispute_on(year, disputer, candidate, Grounds::Computation)
    }

    pub fn dispute_instruction(
        &self,
        year: u16,
        disputer: &Party,
        candidate: ClaimBody,
        grounds: Grounds,
    ) -> Instruction {
        ix(
            eox_settlement_oracle::instruction::Dispute { candidate, grounds },
            eox_settlement_oracle::accounts::DisputeClaim {
                disputer: disputer.key(),
                config: config_pda(),
                epoch: epoch_pda(year),
                disputer_token: disputer.token,
                vault: vault_pda(),
                token_program: spl_token::ID,
            },
        )
    }

    pub fn transaction_bytes(&self, instruction: Instruction, signer: &Keypair) -> usize {
        let msg = Message::new_with_blockhash(
            &[instruction],
            Some(&signer.pubkey()),
            &self.svm.latest_blockhash(),
        );
        1 + 64 + msg.serialize().len()
    }

    pub fn dispute_on(
        &mut self,
        year: u16,
        disputer: &Party,
        candidate: ClaimBody,
        grounds: Grounds,
    ) -> TxResult {
        let instruction = self.dispute_instruction(year, disputer, candidate, grounds);
        self.send(instruction, &disputer.wallet)
    }

    pub fn settle(&mut self, year: u16) -> TxResult {
        let instruction = ix(
            eox_settlement_oracle::instruction::Settle {},
            eox_settlement_oracle::accounts::Settle { epoch: epoch_pda(year) },
        );
        let cranker = Keypair::new();
        self.svm.airdrop(&cranker.pubkey(), 1_000_000_000).unwrap();
        self.send(instruction, &cranker)
    }

    pub fn void(&mut self, year: u16) -> TxResult {
        let instruction = ix(
            eox_settlement_oracle::instruction::VoidEpoch {},
            eox_settlement_oracle::accounts::VoidEpoch { epoch: epoch_pda(year) },
        );
        let cranker = Keypair::new();
        self.svm.airdrop(&cranker.pubkey(), 1_000_000_000).unwrap();
        self.send(instruction, &cranker)
    }

    pub fn resolve_as(&mut self, year: u16, arbiter: &Keypair, resolution: Resolution) -> TxResult {
        let instruction = ix(
            eox_settlement_oracle::instruction::ResolveArbitration { resolution },
            eox_settlement_oracle::accounts::ResolveArbitration {
                arbiter: arbiter.pubkey(),
                config: config_pda(),
                epoch: epoch_pda(year),
            },
        );
        self.send(instruction, arbiter)
    }

    pub fn resolve(&mut self, year: u16, resolution: Resolution) -> TxResult {
        let arbiter = self.arbiter.insecure_clone();
        self.resolve_as(year, &arbiter, resolution)
    }

    pub fn withdraw(&mut self, year: u16, owner: &Keypair, destination: Pubkey) -> TxResult {
        let instruction = ix(
            eox_settlement_oracle::instruction::Withdraw {},
            eox_settlement_oracle::accounts::Withdraw {
                owner: owner.pubkey(),
                config: config_pda(),
                epoch: epoch_pda(year),
                vault: vault_pda(),
                destination,
                token_program: spl_token::ID,
            },
        );
        self.send(instruction, owner)
    }

    pub fn burn_forfeit(&mut self, year: u16) -> TxResult {
        let instruction = ix(
            eox_settlement_oracle::instruction::BurnForfeit {},
            eox_settlement_oracle::accounts::BurnForfeit {
                config: config_pda(),
                epoch: epoch_pda(year),
                vault: vault_pda(),
                bond_mint: self.mint,
                token_program: spl_token::ID,
            },
        );
        let cranker = Keypair::new();
        self.svm.airdrop(&cranker.pubkey(), 1_000_000_000).unwrap();
        self.send(instruction, &cranker)
    }
}

pub struct Flow {
    pub env: TestEnv,
    pub p1: Party,
    pub d1: Party,
    pub p2: Party,
    pub d2: Party,
}

const HOUR: i64 = 3600;

pub fn open_flow() -> Flow {
    let mut env = TestEnv::new();
    env.open_epoch(YEAR, BOND).unwrap();
    let p1 = Party { wallet: env.proposer.wallet.insecure_clone(), token: env.proposer.token };
    let p2 = Party {
        wallet: env.second_proposer.wallet.insecure_clone(),
        token: env.second_proposer.token,
    };
    let d1 = env.party(START);
    let d2 = env.party(START);
    Flow { env, p1, d1, p2, d2 }
}

pub fn proposed_flow(first_hash: u8) -> Flow {
    let mut f = open_flow();
    f.env.set_time(cutoff() + HOUR);
    f.env.propose(YEAR, &f.p1, body(first_hash)).unwrap();
    f
}

pub fn reset_flow() -> Flow {
    let mut f = proposed_flow(10);
    f.env.set_time(cutoff() + 2 * HOUR);
    f.env.dispute(YEAR, &f.d1, body(20)).unwrap();
    f
}

pub fn reproposed_flow(second_hash: u8) -> Flow {
    let mut f = reset_flow();
    f.env.set_time(cutoff() + 3 * HOUR);
    f.env.propose(YEAR, &f.p2, body(second_hash)).unwrap();
    f
}

pub fn escalated_flow() -> Flow {
    let mut f = reproposed_flow(10);
    f.env.set_time(cutoff() + 4 * HOUR);
    f.env.dispute(YEAR, &f.d2, body(30)).unwrap();
    f
}
