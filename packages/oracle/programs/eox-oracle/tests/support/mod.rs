use ::eox_oracle::{accounts as a, instruction as i, Registry, Snapshot, ID};
use anchor_lang::{AccountDeserialize, AnchorSerialize, InstructionData, ToAccountMetas};
use eox_oracle_math as math;
use litesvm::LiteSVM;
use solana_sdk::{
    clock::Clock,
    instruction::{AccountMeta, Instruction},
    message::Message,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_program,
    transaction::Transaction,
};

pub(crate) fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &ID).0
}
pub(crate) struct Harness {
    pub(crate) svm: LiteSVM,
    pub(crate) authority: Keypair,
    pub(crate) adapter: Keypair,
    pub(crate) registry: Pubkey,
    pub(crate) epoch: Pubkey,
    pub(crate) n: u8,
    pub(crate) indicators: u8,
    pub(crate) max_bytes: usize,
    pub(crate) max_compute: u64,
}
impl Harness {
    pub(crate) fn new(n: u8, indicators: u8) -> Self {
        let mut svm = LiteSVM::new();
        let path = std::env::var("EOX_PROGRAM_SO").unwrap_or_else(|_| {
            format!(
                "{}/../../target/deploy/eox_oracle.so",
                env!("CARGO_MANIFEST_DIR")
            )
        });
        let bytes = std::fs::read(&path)
            .unwrap_or_else(|e| panic!("SBF artifact {path}: {e}; build it first"));
        svm.add_program(ID, &bytes);
        let authority = Keypair::new();
        let adapter = Keypair::new();
        svm.airdrop(&authority.pubkey(), 100_000_000_000).unwrap();
        svm.airdrop(&adapter.pubkey(), 10_000_000_000).unwrap();
        let registry = pda(&[b"registry"]);
        let epoch = pda(&[b"epoch", &1u64.to_le_bytes()]);
        let mut h = Self {
            svm,
            authority,
            adapter,
            registry,
            epoch,
            n,
            indicators,
            max_bytes: 0,
            max_compute: 0,
        };
        h.time(100_000);
        h.send(
            a::Initialize {
                registry,
                authority: h.authority.pubkey(),
                system_program: system_program::ID,
            },
            i::Initialize {
                adapter: h.adapter.pubkey(),
            },
            false,
            true,
        );
        h.send(
            a::CreateEpoch {
                registry,
                epoch,
                authority: h.authority.pubkey(),
                system_program: system_program::ID,
            },
            i::CreateEpoch {
                id: 1,
                countries: (0..n).map(|c| [b'A' + c / 26, b'A' + c % 26]).collect(),
                indicator_counts: vec![indicators; n as usize],
                multiplier: 20,
            },
            false,
            true,
        );
        for c in 0..n {
            for j in 0..indicators {
                let page = j / 8;
                h.send(
                    a::AppendRule {
                        registry,
                        epoch,
                        rules: h.rules(c, page),
                        authority: h.authority.pubkey(),
                        system_program: system_program::ID,
                    },
                    i::AppendRule {
                        country: c,
                        page,
                        rule: h.rule(c, j).try_to_vec().unwrap(),
                    },
                    false,
                    true,
                );
            }
        }
        h.send(
            a::EpochAdmin {
                registry,
                epoch,
                authority: h.authority.pubkey(),
            },
            i::SealEpoch {},
            false,
            true,
        );
        h
    }
    pub(crate) fn time(&mut self, t: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp = t;
        self.svm.set_sysvar(&clock);
    }
    pub(crate) fn read<T: AccountDeserialize>(&self, key: Pubkey) -> T {
        let data = self.svm.get_account(&key).expect("account exists").data;
        T::try_deserialize(&mut &data[..]).unwrap()
    }
    pub(crate) fn send<A: ToAccountMetas, D: InstructionData>(
        &mut self,
        accounts: A,
        data: D,
        adapter: bool,
        success: bool,
    ) {
        self.send_remaining(accounts, data, vec![], adapter, success)
    }
    pub(crate) fn send_remaining<A: ToAccountMetas, D: InstructionData>(
        &mut self,
        accounts: A,
        data: D,
        remaining: Vec<AccountMeta>,
        adapter: bool,
        success: bool,
    ) {
        let mut metas = accounts.to_account_metas(None);
        metas.extend(remaining);
        let ix = Instruction {
            program_id: ID,
            accounts: metas,
            data: data.data(),
        };
        self.svm.expire_blockhash();
        let signer = if adapter {
            &self.adapter
        } else {
            &self.authority
        };
        let tx = Transaction::new(
            &[signer],
            Message::new(&[ix], Some(&signer.pubkey())),
            self.svm.latest_blockhash(),
        );
        let bytes = bincode::serialize(&tx).unwrap().len();
        assert!(bytes <= 1232, "transaction exceeds packet size: {bytes}");
        self.max_bytes = self.max_bytes.max(bytes);
        let result = self.svm.send_transaction(tx);
        if success {
            let meta = result.unwrap_or_else(|e| panic!("runtime failure: {e:?}"));
            self.max_compute = self.max_compute.max(meta.compute_units_consumed);
        } else {
            assert!(result.is_err(), "expected program rejection");
        }
    }
    pub(crate) fn rules(&self, c: u8, p: u8) -> Pubkey {
        pda(&[b"rules", self.epoch.as_ref(), &[c], &[p]])
    }
    pub(crate) fn page(&self, s: Pubkey, c: u8, p: u8) -> Pubkey {
        pda(&[b"page", s.as_ref(), &[c], &[p]])
    }
    pub(crate) fn history(&self, e: &math::Evidence) -> Pubkey {
        pda(&[b"history", &math::evidence_digest(e).unwrap()])
    }
    pub(crate) fn rule(&self, c: u8, j: u8) -> math::Rule {
        let mut series = [0; 32];
        series[0] = c;
        series[1] = j;
        math::Rule {
            series_id: series,
            transform: math::Transform::Difference,
            normalization: math::Normalization::Directional {
                lower: -1_000_000,
                upper: 1_000_000,
                direction: 1,
            },
            weight: 1,
            unit: [3; 32],
            source: [4; 32],
            source_authority: 10_000,
            comparison_period_delta: 1,
            grace_seconds: 2_592_000,
            zero_seconds: 7_776_000,
        }
    }
    pub(crate) fn slot(&self, c: u8, j: u8, revision: u8) -> math::Slot {
        let r = self.rule(c, j);
        let e = math::Evidence {
            record_id: [revision; 32],
            series_id: r.series_id,
            artifact_digest: [revision; 32],
            metadata_digest: [0; 32],
            unit: r.unit,
            source: r.source,
            value: revision as i64 * 1_000,
            published_at: Some(99_900),
            known_at: Some(99_900),
            recorded_at: 99_900,
            period: 2,
            quality: [10_000; 8],
        };
        let mut comparison = e.clone();
        comparison.period = 1;
        comparison.value = 0;
        math::Slot {
            current: e,
            comparison: Some(comparison),
        }
    }
    pub(crate) fn operation(&self, s: Pubkey) -> a::SnapshotOperation {
        a::SnapshotOperation {
            registry: self.registry,
            epoch: self.epoch,
            snapshot: s,
            authority: self.authority.pubkey(),
        }
    }
    pub(crate) fn page_operation(&self, s: Pubkey, c: u8, p: u8) -> a::PageOperation {
        a::PageOperation {
            registry: self.registry,
            epoch: self.epoch,
            snapshot: s,
            rules: self.rules(c, p),
            page_account: self.page(s, c, p),
            authority: self.authority.pubkey(),
        }
    }
    pub(crate) fn new_snapshot(&mut self, revision: u8) -> Pubkey {
        self.new_snapshot_with(revision, |_, _| {})
    }
    pub(crate) fn new_snapshot_with<F: FnOnce(&mut Self, Pubkey)>(&mut self, revision: u8, pin: F) -> Pubkey {
        let r: Registry = self.read(self.registry);
        let s = pda(&[
            b"snapshot",
            self.epoch.as_ref(),
            &r.next_sequence.to_le_bytes(),
        ]);
        let cutoff = self.svm.get_sysvar::<Clock>().unix_timestamp;
        self.send(
            a::CreateSnapshot {
                registry: self.registry,
                epoch: self.epoch,
                snapshot: s,
                authority: self.authority.pubkey(),
                system_program: system_program::ID,
            },
            i::CreateSnapshot {
                sequence: r.next_sequence,
                cutoff,
            },
            false,
            true,
        );
        pin(self, s);
        for c in 0..self.n {
            for j in 0..self.indicators {
                let slot = self.slot(c, j, revision);
                for e in [&slot.current, slot.comparison.as_ref().unwrap()] {
                    self.send(
                        a::InitializeHistory {
                            history: self.history(e),
                            authority: self.authority.pubkey(),
                            system_program: system_program::ID,
                        },
                        i::InitializeHistory {
                            evidence: e.try_to_vec().unwrap(),
                        },
                        false,
                        true,
                    );
                }
                self.send(
                    a::UploadSlot {
                        registry: self.registry,
                        epoch: self.epoch,
                        snapshot: s,
                        rules: self.rules(c, j / 8),
                        page_account: self.page(s, c, j / 8),
                        authority: self.authority.pubkey(),
                        system_program: system_program::ID,
                    },
                    i::UploadSlot {
                        country: c,
                        page: j / 8,
                        index: j % 8,
                        slot: slot.try_to_vec().unwrap(),
                    },
                    false,
                    true,
                );
            }
            for p in 0..self.indicators.div_ceil(8) {
                if c == 0 && p == 0 {
                    // Retry the first upload, then attempt a conflicting replacement.
                    for (revision, succeeds) in [(revision, true), (revision + 1, false)] {
                        self.send(
                            a::UploadSlot {
                                registry: self.registry,
                                epoch: self.epoch,
                                snapshot: s,
                                rules: self.rules(c, p),
                                page_account: self.page(s, c, p),
                                authority: self.authority.pubkey(),
                                system_program: system_program::ID,
                            },
                            i::UploadSlot {
                                country: c,
                                page: p,
                                index: 0,
                                slot: self.slot(c, 0, revision).try_to_vec().unwrap(),
                            },
                            false,
                            succeeds,
                        );
                    }
                }
                self.send(
                    self.page_operation(s, c, p),
                    i::FreezePage {
                        country: c,
                        page: p,
                    },
                    false,
                    true,
                );
            }
        }
        if self.read::<Snapshot>(s).adapter == self.adapter.pubkey() {
            self.send(self.operation(s), i::Precommit {}, false, true);
        }
        s
    }
    pub(crate) fn register(&mut self, s: Pubkey, revision: u8, id: [u8; 32], success: bool) {
        let e = self.slot(0, 0, revision).current;
        self.send(
            a::RegisterChallenge {
                registry: self.registry,
                snapshot: s,
                page_account: self.page(s, 0, 0),
                history: self.history(&e),
                challenge: pda(&[b"challenge", &id]),
                adapter: self.adapter.pubkey(),
                system_program: system_program::ID,
            },
            i::RegisterChallenge {
                id,
                evidence: math::evidence_digest(&e).unwrap(),
                slot_index: 0,
                comparison: false,
            },
            true,
            success,
        )
    }
    pub(crate) fn resolve(&mut self, s: Pubkey, revision: u8, id: [u8; 32], invalid: bool) {
        let e = self.slot(0, 0, revision).current;
        self.send(
            a::ResolveChallenge {
                registry: self.registry,
                snapshot: s,
                challenge: pda(&[b"challenge", &id]),
                history: self.history(&e),
                adapter: self.adapter.pubkey(),
            },
            i::ResolveChallenge { invalid },
            true,
            true,
        )
    }
    pub(crate) fn close(&mut self, s: Pubkey) {
        let snapshot: Snapshot = self.read(s);
        self.time(snapshot.deadline);
        self.send(
            a::AdapterSnapshot {
                registry: self.registry,
                snapshot: s,
                adapter: self.adapter.pubkey(),
            },
            i::CloseWindow {
                count: snapshot.event_count,
                digest: snapshot.event_digest,
            },
            true,
            true,
        )
    }
    pub(crate) fn calculate(&mut self, s: Pubkey, revision: u8) {
        for c in 0..self.n {
            for p in 0..self.indicators.div_ceil(8) {
                let mut accounts = vec![];
                for j in p * 8..((p + 1) * 8).min(self.indicators) {
                    let slot = self.slot(c, j, revision);
                    accounts.push(AccountMeta::new_readonly(
                        self.history(&slot.current),
                        false,
                    ));
                    accounts.push(AccountMeta::new_readonly(
                        self.history(slot.comparison.as_ref().unwrap()),
                        false,
                    ));
                }
                self.send_remaining(
                    self.page_operation(s, c, p),
                    i::CalculatePage {
                        country: c,
                        page: p,
                    },
                    accounts,
                    false,
                    true,
                );
            }
        }
    }
    pub(crate) fn publish(&mut self, s: Pubkey) {
        self.send(
            a::Publish {
                registry: self.registry,
                epoch: self.epoch,
                snapshot: s,
                authority: self.authority.pubkey(),
            },
            i::Publish {},
            false,
            true,
        )
    }
}
