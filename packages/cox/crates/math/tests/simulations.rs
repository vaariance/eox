use cox_math::{batch, reference, revalue, Class, Ledger, Operation, Outcome, Request, SCALE};

fn class(backing: u64) -> Class {
    Class {
        backing,
        units: u128::from(backing) * SCALE as u128,
    }
}

fn request(id: &str, operation: Operation) -> Request {
    Request {
        id: id.into(),
        expiry: u64::MAX,
        operation,
    }
}

fn active(classes: &[Class]) -> u128 {
    classes.iter().map(|value| u128::from(value.backing)).sum()
}

#[test]
fn equal_asset_returns_leave_references_and_pool_shares_unchanged() {
    let result = reference(&[100, 200], &[110, 220], &[100, 200], 100 * SCALE).unwrap();
    assert_eq!(result.relative, vec![100 * SCALE; 2]);
    assert_eq!(result.h, vec![SCALE; 3]);
    let classes = vec![class(100), class(50), class(25)];
    let marked = revalue(&classes, &result.h).unwrap();
    assert_eq!(marked.classes, classes);
    assert_eq!(marked.residual, 0);
}

#[test]
fn missed_minutes_link_to_last_accepted_prices_without_intermediate_rebalances() {
    let frozen = reference(&[100, 100], &[100, 100], &[100, 100], 100 * SCALE).unwrap();
    let intermediate = reference(&[100, 100], &[200, 100], &[100, 100], 100 * SCALE).unwrap();
    let rebalanced = reference(
        &[200, 100],
        &[100, 100],
        &[100, 100],
        intermediate.benchmark,
    )
    .unwrap();
    assert_eq!(frozen.benchmark, 100 * SCALE);
    assert_eq!(rebalanced.benchmark, 112_500_000_000_000);
    assert_ne!(frozen.benchmark, rebalanced.benchmark);
}

#[test]
fn entry_after_gain_uses_the_revalued_unit_price() {
    let marked = revalue(&[class(100), class(100)], &[2 * SCALE, SCALE]).unwrap();
    let result = batch(
        &marked.classes,
        &[request(
            "entry",
            Operation::Deposit {
                to: 0,
                amount: 30,
                min_units: 0,
            },
        )],
        1,
    )
    .unwrap();
    assert!(result.receipts[0].minted < 30 * SCALE as u128);
    assert_eq!(
        result.receipts[0].minted,
        30 * marked.classes[0].units / u128::from(marked.classes[0].backing)
    );
    assert_eq!(
        active(&marked.classes) + 30,
        active(&result.classes) + u128::from(result.residual)
    );
}

#[test]
fn exit_after_loss_cannot_claim_the_old_unit_price() {
    let marked = revalue(&[class(100), class(100)], &[SCALE / 2, SCALE]).unwrap();
    let result = batch(
        &marked.classes,
        &[request(
            "exit",
            Operation::Redeem {
                from: 0,
                units: 10 * SCALE as u128,
                min_proceeds: 0,
            },
        )],
        1,
    )
    .unwrap();
    assert!(result.payable < 10);
    assert_eq!(result.payable, 6);
    assert_eq!(
        active(&marked.classes),
        active(&result.classes) + u128::from(result.payable) + u128::from(result.residual)
    );
}

#[test]
fn request_permutations_have_identical_accounting_and_individual_outcomes() {
    let classes = vec![
        Class {
            backing: 90,
            units: 100 * SCALE as u128,
        },
        Class {
            backing: 60,
            units: 50 * SCALE as u128,
        },
        class(0),
    ];
    let requests = vec![
        request(
            "entry",
            Operation::Deposit {
                to: 0,
                amount: 30,
                min_units: 0,
            },
        ),
        request(
            "exit",
            Operation::Redeem {
                from: 1,
                units: 10 * SCALE as u128,
                min_proceeds: 0,
            },
        ),
        request(
            "switch",
            Operation::Switch {
                from: 0,
                to: 2,
                units: 10 * SCALE as u128,
                min_units: 0,
            },
        ),
        request(
            "rejected",
            Operation::Deposit {
                to: 1,
                amount: 7,
                min_units: u128::MAX,
            },
        ),
    ];
    let expected = batch(&classes, &requests, 1).unwrap();
    for order in [[3, 2, 1, 0], [1, 3, 0, 2], [2, 0, 3, 1], [0, 2, 1, 3]] {
        let reordered: Vec<_> = order.iter().map(|index| requests[*index].clone()).collect();
        let result = batch(&classes, &reordered, 1).unwrap();
        assert_eq!(result.classes, expected.classes);
        assert_eq!(
            (result.payable, result.refunds, result.residual),
            (expected.payable, expected.refunds, expected.residual)
        );
        for receipt in result.receipts {
            assert_eq!(
                &receipt,
                expected
                    .receipts
                    .iter()
                    .find(|item| item.id == receipt.id)
                    .unwrap()
            );
        }
    }
}

#[test]
fn splitting_deposits_redemptions_and_switches_never_increases_user_output() {
    for backing in 1..48 {
        let classes = vec![
            Class {
                backing,
                units: 43 * SCALE as u128,
            },
            Class {
                backing: 29,
                units: 37 * SCALE as u128,
            },
        ];
        for count in 2..12_u64 {
            for kind in 0..3 {
                let operation = |multiple: u64| match kind {
                    0 => Operation::Deposit {
                        to: 0,
                        amount: multiple,
                        min_units: 0,
                    },
                    1 => Operation::Redeem {
                        from: 0,
                        units: u128::from(multiple) * SCALE as u128,
                        min_proceeds: 0,
                    },
                    _ => Operation::Switch {
                        from: 0,
                        to: 1,
                        units: u128::from(multiple) * SCALE as u128,
                        min_units: 0,
                    },
                };
                let whole = batch(&classes, &[request("whole", operation(count))], 1).unwrap();
                let parts: Vec<_> = (0..count)
                    .map(|index| request(&index.to_string(), operation(1)))
                    .collect();
                let split = batch(&classes, &parts, 1).unwrap();
                assert!(
                    split
                        .receipts
                        .iter()
                        .map(|receipt| receipt.minted)
                        .sum::<u128>()
                        <= whole.receipts[0].minted
                );
                assert!(
                    split
                        .receipts
                        .iter()
                        .map(|receipt| u128::from(receipt.proceeds))
                        .sum::<u128>()
                        <= u128::from(whole.receipts[0].proceeds)
                );
            }
        }
    }
}

#[test]
fn mass_exit_drains_claims_and_preserves_every_collateral_unit() {
    let classes: Vec<_> = (1..=31).map(|index| class(index * 100)).collect();
    let requests: Vec<_> = classes
        .iter()
        .enumerate()
        .flat_map(|(from, value)| {
            (0..100).map(move |index| {
                request(
                    &format!("{from}:{index}"),
                    Operation::Redeem {
                        from,
                        units: value.units / 100,
                        min_proceeds: 0,
                    },
                )
            })
        })
        .collect();
    let result = batch(&classes, &requests, 1).unwrap();
    assert!(result
        .classes
        .iter()
        .all(|value| value.units == 0 && value.backing == 0));
    assert_eq!(
        active(&classes),
        u128::from(result.payable) + u128::from(result.residual)
    );
    assert_eq!(result.residual, 0);
}

#[test]
fn worthless_claims_can_exit_but_cannot_accept_new_deposits() {
    let classes = vec![
        Class {
            backing: 0,
            units: 10 * SCALE as u128,
        },
        class(0),
    ];
    let result = batch(
        &classes,
        &[
            request(
                "blocked",
                Operation::Deposit {
                    to: 0,
                    amount: 5,
                    min_units: 0,
                },
            ),
            request(
                "exit",
                Operation::Redeem {
                    from: 0,
                    units: classes[0].units,
                    min_proceeds: 0,
                },
            ),
            request(
                "bootstrap",
                Operation::Deposit {
                    to: 1,
                    amount: 7,
                    min_units: 0,
                },
            ),
        ],
        1,
    )
    .unwrap();
    assert_eq!(result.receipts[0].outcome, Outcome::ZeroValueClass);
    assert_eq!(result.refunds, 5);
    assert_eq!(result.classes[0], class(0));
    assert_eq!(result.classes[1], class(7));
    assert_eq!(result.payable, 0);
}

struct Seed(u64);

impl Seed {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
}

#[test]
fn seeded_thirty_asset_paths_reconcile_the_full_vault_after_every_publication() {
    for seed in 1..=24 {
        let mut rng = Seed(seed);
        let mut prices = vec![100_000_000_u64; 30];
        let origin = prices.clone();
        let mut benchmark = 100 * SCALE;
        let mut classes = vec![class(10_000); 31];
        let mut residual = 0_u128;
        let mut vault = active(&classes);
        let mut ledger = Ledger {
            vault: vault as u64,
            active: vault as u64,
            pending: 0,
            payable: 0,
            residual: 0,
        };
        for publication in 1..=120 {
            let current: Vec<_> = prices
                .iter()
                .map(|price| price * (90 + rng.next() % 21) / 100)
                .collect();
            let references = reference(&prices, &current, &origin, benchmark).unwrap();
            let marked = revalue(&classes, &references.h).unwrap();
            ledger = ledger.apply_revaluation(&marked).unwrap();
            residual += u128::from(marked.residual);
            let to = rng.next() as usize % 31;
            let from = (to + 1) % 31;
            let switch_from = (to + 2) % 31;
            let amount = 1 + rng.next() % 100;
            let mut requests = vec![request(
                "deposit",
                Operation::Deposit {
                    to,
                    amount,
                    min_units: 0,
                },
            )];
            if marked.classes[from].units >= 10 {
                requests.push(request(
                    "redeem",
                    Operation::Redeem {
                        from,
                        units: marked.classes[from].units / 10,
                        min_proceeds: 0,
                    },
                ));
            }
            if marked.classes[switch_from].units >= 20 {
                requests.push(request(
                    "switch",
                    Operation::Switch {
                        from: switch_from,
                        to,
                        units: marked.classes[switch_from].units / 20,
                        min_units: 0,
                    },
                ));
            }
            if publication % 7 == 0 {
                requests[0].expiry = publication - 1;
            }
            vault += u128::from(amount);
            ledger = ledger.deposit(amount).unwrap();
            let result = batch(&marked.classes, &requests, publication).unwrap();
            ledger = ledger.apply_batch(&result).unwrap();
            residual += u128::from(result.residual);
            assert_eq!(
                vault,
                active(&result.classes)
                    + residual
                    + u128::from(result.payable)
                    + u128::from(result.refunds),
                "seed {seed}, publication {publication}"
            );
            vault -= u128::from(result.payable) + u128::from(result.refunds);
            ledger = ledger.withdraw(result.payable).unwrap();
            ledger = ledger.refund(result.refunds).unwrap();
            ledger.validate().unwrap();
            assert_eq!(u128::from(ledger.vault), vault);
            assert_eq!(u128::from(ledger.active), active(&result.classes));
            assert_eq!(u128::from(ledger.residual), residual);
            classes = result.classes;
            prices = current;
            benchmark = references.benchmark;
        }
    }
}

#[test]
fn repeated_entry_exit_cycles_cannot_extract_existing_holders_backing() {
    for amount in 1..=31 {
        let mut classes = vec![
            Class {
                backing: 90_000,
                units: 100_000 * SCALE as u128,
            },
            class(60),
        ];
        let mut deposited = 0_u64;
        let mut withdrawn = 0_u64;
        let mut residual = 0_u64;
        for publication in 1..=200 {
            let entry = batch(
                &classes,
                &[request(
                    "entry",
                    Operation::Deposit {
                        to: 0,
                        amount,
                        min_units: 0,
                    },
                )],
                publication,
            )
            .unwrap();
            deposited += amount;
            residual += entry.residual;
            let minted = entry.receipts[0].minted;
            assert_eq!(entry.receipts[0].outcome, Outcome::Filled);
            let exit = batch(
                &entry.classes,
                &[request(
                    "exit",
                    Operation::Redeem {
                        from: 0,
                        units: minted,
                        min_proceeds: 0,
                    },
                )],
                publication + 1,
            )
            .unwrap();
            withdrawn += exit.payable;
            residual += exit.residual;
            assert!(withdrawn <= deposited);
            assert_eq!(
                90_060 + u128::from(deposited),
                active(&exit.classes) + u128::from(withdrawn) + u128::from(residual)
            );
            classes = exit.classes;
        }
    }
}

#[test]
fn malformed_inputs_over_reservation_and_overflow_fail_without_mutating_input() {
    let classes = vec![class(1), class(1)];
    let saved = classes.clone();
    assert!(reference(&[0, 100], &[100, 100], &[100, 100], 100 * SCALE).is_err());
    assert!(reference(&[100], &[100], &[100], 100 * SCALE).is_err());
    assert!(reference(&[100, 100], &[100, 100], &[100, 100], i128::MAX).is_err());
    assert!(revalue(&classes, &[0, 0]).is_err());
    assert!(revalue(&classes, &[i128::MAX, i128::MAX]).is_err());
    assert!(batch(
        &classes,
        &[request(
            "overspend",
            Operation::Redeem {
                from: 0,
                units: 2 * SCALE as u128,
                min_proceeds: 0
            }
        )],
        1
    )
    .is_err());
    assert!(batch(
        &classes,
        &[request(
            "overflow",
            Operation::Deposit {
                to: 0,
                amount: u64::MAX,
                min_units: 0
            }
        )],
        1
    )
    .is_err());
    assert_eq!(classes, saved);
}
