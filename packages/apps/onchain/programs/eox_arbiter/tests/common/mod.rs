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
    eox_arbiter::{constants::*, error::ErrorCode, state::Case},
    eox_settlement_oracle::{
        constants::{cutoff_timestamp, CONFIG_SEED, EPOCH_SEED, VAULT_SEED as ORACLE_VAULT_SEED},
        state::{ClaimBody, Epoch, Resolution},
        Grounds,
    },
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
pub const MEMBER_BOND: u64 = 5_500_000_000;
pub const IMAGE_ID: [u8; 32] = [2u8; 32];
const HOUR: i64 = 3600;

pub fn cutoff() -> i64 {
    cutoff_timestamp(YEAR)
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
    let code: u32 = expected.into();
    let err = result.expect_err("transaction should fail");
    let rendered = format!("{:?}", err.err);
    assert!(
        rendered.contains(&format!("Custom({code})")),
        "expected error {code}, got {rendered}"
    );
}

fn arbiter_pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &eox_arbiter::id()).0
}

fn oracle_pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &eox_settlement_oracle::id()).0
}

pub fn arbiter_authority() -> Pubkey {
    arbiter_pda(&[AUTHORITY_SEED])
}

pub fn case_pda(year: u16) -> Pubkey {
    arbiter_pda(&[CASE_SEED, &year.to_le_bytes()])
}

pub fn epoch_pda(year: u16) -> Pubkey {
    oracle_pda(&[EPOCH_SEED, &year.to_le_bytes()])
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

pub struct Panel {
    pub svm: LiteSVM,
    pub mint: Pubkey,
    pub members: Vec<Party>,
    pub proposers: Vec<Party>,
    pub disputers: Vec<Party>,
}

fn new_ix<A: InstructionData, M: ToAccountMetas>(program: Pubkey, data: A, accounts: M) -> Instruction {
    Instruction::new_with_bytes(program, &data.data(), accounts.to_account_metas(None))
}

impl Panel {
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

    fn token_account(&mut self, owner: &Pubkey, amount: u64) -> Pubkey {
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
                Account { lamports: 1_000_000_000, data, owner: spl_token::ID, executable: false, rent_epoch: 0 },
            )
            .unwrap();
        address
    }

    pub fn party(&mut self, tokens: u64) -> Party {
        let wallet = Keypair::new();
        self.svm.airdrop(&wallet.pubkey(), 10_000_000_000).unwrap();
        let token = self.token_account(&wallet.pubkey(), tokens);
        Party { wallet, token }
    }

    pub fn token_amount(&self, address: &Pubkey) -> u64 {
        TokenAccount::unpack(&self.svm.get_account(address).unwrap().data).unwrap().amount
    }

    pub fn epoch(&self) -> Epoch {
        let account = self.svm.get_account(&epoch_pda(YEAR)).unwrap();
        Epoch::try_deserialize(&mut account.data.as_slice()).unwrap()
    }

    pub fn case(&self) -> Case {
        let account = self.svm.get_account(&case_pda(YEAR)).unwrap();
        Case::try_deserialize(&mut account.data.as_slice()).unwrap()
    }

    /// The settlement oracle with this panel as its arbiter, an open epoch and a seated,
    /// unbonded panel.
    pub fn new() -> Self {
        let mut p = Self::without_panel();
        let members: [Pubkey; PANEL_SIZE] = [p.members[0].key(), p.members[1].key(), p.members[2].key()];
        let authority = p.party(0).wallet;
        p.initialize_panel(&authority, members, MEMBER_BOND).unwrap();
        p
    }

    pub fn without_panel() -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program(
            eox_settlement_oracle::id(),
            include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/eox_settlement_oracle.so")),
        )
        .unwrap();
        svm.add_program(
            eox_arbiter::id(),
            include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/eox_arbiter.so")),
        )
        .unwrap();

        let authority = Keypair::new();
        svm.airdrop(&authority.pubkey(), 10_000_000_000).unwrap();
        let mint = Pubkey::new_unique();
        let mut data = vec![0u8; Mint::LEN];
        Mint {
            mint_authority: COption::Some(authority.pubkey()),
            supply: 1_000_000_000_000_000,
            decimals: 6,
            is_initialized: true,
            freeze_authority: COption::None,
        }
        .pack_into_slice(&mut data);
        svm.set_account(
            mint,
            Account { lamports: 1_000_000_000, data, owner: spl_token::ID, executable: false, rent_epoch: 0 },
        )
        .unwrap();

        let mut p = Self { svm, mint, members: vec![], proposers: vec![], disputers: vec![] };
        p.proposers = (0..2).map(|_| p.party(5 * BOND)).collect();
        p.disputers = (0..2).map(|_| p.party(5 * BOND)).collect();
        p.members = (0..3).map(|_| p.party(MEMBER_BOND)).collect();

        let init_oracle = new_ix(
            eox_settlement_oracle::id(),
            eox_settlement_oracle::instruction::Initialize {
                arbiter: arbiter_authority(),
                proposers: p.proposers.iter().map(Party::key).collect(),
            },
            eox_settlement_oracle::accounts::Initialize {
                authority: authority.pubkey(),
                config: oracle_pda(&[CONFIG_SEED]),
                bond_mint: mint,
                vault: oracle_pda(&[ORACLE_VAULT_SEED]),
                token_program: spl_token::ID,
                system_program: system_program::ID,
            },
        );
        p.send(init_oracle, &authority).unwrap();

        let open_epoch = new_ix(
            eox_settlement_oracle::id(),
            eox_settlement_oracle::instruction::OpenEpoch { year: YEAR, bond: BOND, methodology_image_id: IMAGE_ID },
            eox_settlement_oracle::accounts::OpenEpoch {
                authority: authority.pubkey(),
                config: oracle_pda(&[CONFIG_SEED]),
                epoch: epoch_pda(YEAR),
                system_program: system_program::ID,
            },
        );
        p.send(open_epoch, &authority).unwrap();
        p
    }

    pub fn initialize_panel(&mut self, authority: &Keypair, members: [Pubkey; PANEL_SIZE], member_bond: u64) -> TxResult {
        let instruction = new_ix(
            eox_arbiter::id(),
            eox_arbiter::instruction::InitializePanel { members, member_bond },
            eox_arbiter::accounts::InitializePanel {
                authority: authority.pubkey(),
                panel: arbiter_pda(&[PANEL_SEED]),
                arbiter_authority: arbiter_authority(),
                bond_mint: self.mint,
                vault: arbiter_pda(&[VAULT_SEED]),
                token_program: spl_token::ID,
                system_program: system_program::ID,
            },
        );
        self.send(instruction, authority)
    }

    pub fn post_bond(&mut self, member: usize) -> TxResult {
        let (wallet, token) = (self.members[member].wallet.insecure_clone(), self.members[member].token);
        self.post_bond_as(&wallet, token)
    }

    pub fn post_bond_as(&mut self, wallet: &Keypair, token: Pubkey) -> TxResult {
        let instruction = new_ix(
            eox_arbiter::id(),
            eox_arbiter::instruction::PostBond {},
            eox_arbiter::accounts::PostBond {
                member: wallet.pubkey(),
                panel: arbiter_pda(&[PANEL_SEED]),
                member_token: token,
                vault: arbiter_pda(&[VAULT_SEED]),
                token_program: spl_token::ID,
            },
        );
        self.send(instruction, wallet)
    }

    pub fn vault_amount(&self) -> u64 {
        self.token_amount(&arbiter_pda(&[VAULT_SEED]))
    }

    fn propose(&mut self, proposer: usize, claim: ClaimBody) {
        let p = &self.proposers[proposer];
        let (wallet, token) = (p.wallet.insecure_clone(), p.token);
        let instruction = new_ix(
            eox_settlement_oracle::id(),
            eox_settlement_oracle::instruction::Propose { body: claim },
            eox_settlement_oracle::accounts::Propose {
                proposer: wallet.pubkey(),
                config: oracle_pda(&[CONFIG_SEED]),
                epoch: epoch_pda(YEAR),
                proposer_token: token,
                vault: oracle_pda(&[ORACLE_VAULT_SEED]),
                token_program: spl_token::ID,
            },
        );
        self.send(instruction, &wallet).unwrap();
    }

    fn dispute(&mut self, disputer: usize, candidate: ClaimBody) {
        let d = &self.disputers[disputer];
        let (wallet, token) = (d.wallet.insecure_clone(), d.token);
        let instruction = new_ix(
            eox_settlement_oracle::id(),
            eox_settlement_oracle::instruction::Dispute { candidate, grounds: Grounds::Computation },
            eox_settlement_oracle::accounts::DisputeClaim {
                disputer: wallet.pubkey(),
                config: oracle_pda(&[CONFIG_SEED]),
                epoch: epoch_pda(YEAR),
                disputer_token: token,
                vault: oracle_pda(&[ORACLE_VAULT_SEED]),
                token_program: spl_token::ID,
            },
        );
        self.send(instruction, &wallet).unwrap();
    }

    /// Proposal 10, disputed with 20, re-proposed as 10, disputed again with 30.
    pub fn escalate(&mut self) {
        self.set_time(cutoff() + HOUR);
        self.propose(0, body(10));
        self.set_time(cutoff() + 2 * HOUR);
        self.dispute(0, body(20));
        self.set_time(cutoff() + 3 * HOUR);
        self.propose(1, body(10));
        self.set_time(cutoff() + 4 * HOUR);
        self.dispute(1, body(30));
    }

    pub fn open_case(&mut self) -> TxResult {
        let instruction = new_ix(
            eox_arbiter::id(),
            eox_arbiter::instruction::OpenCase {},
            eox_arbiter::accounts::OpenCase {
                payer: self.members[0].key(),
                epoch: epoch_pda(YEAR),
                case: case_pda(YEAR),
                system_program: system_program::ID,
            },
        );
        let payer = self.members[0].wallet.insecure_clone();
        self.send(instruction, &payer)
    }

    pub fn vote_as(&mut self, wallet: &Keypair, choice: Resolution) -> TxResult {
        let instruction = new_ix(
            eox_arbiter::id(),
            eox_arbiter::instruction::Vote { choice, rationale_hash: [7u8; 32] },
            eox_arbiter::accounts::CastVote {
                member: wallet.pubkey(),
                panel: arbiter_pda(&[PANEL_SEED]),
                case: case_pda(YEAR),
                epoch: epoch_pda(YEAR),
                oracle_config: oracle_pda(&[CONFIG_SEED]),
                arbiter_authority: arbiter_authority(),
                oracle_program: eox_settlement_oracle::id(),
            },
        );
        self.send(instruction, wallet)
    }

    pub fn vote(&mut self, member: usize, choice: Resolution) -> TxResult {
        let wallet = self.members[member].wallet.insecure_clone();
        self.vote_as(&wallet, choice)
    }

    /// A bonded panel with an open case on an escalated epoch.
    pub fn ready() -> Self {
        let mut p = Self::new();
        for member in 0..PANEL_SIZE {
            p.post_bond(member).unwrap();
        }
        p.escalate();
        p.open_case().unwrap();
        p
    }
}
