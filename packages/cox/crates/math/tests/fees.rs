use cox_math::{
    batch, batch_with_fees, Class, FeeTerms, MathError, Operation, Outcome, Request, SCALE,
};

fn request(id: &str, operation: Operation) -> Request {
    Request {
        id: id.into(),
        expiry: 10,
        operation,
    }
}
fn class(backing: u64) -> Class {
    Class {
        backing,
        units: u128::from(backing) * SCALE as u128,
    }
}
fn terms() -> FeeTerms {
    FeeTerms {
        version: 7,
        bps: 2,
        cap: 2_000_000,
    }
}
fn deposit(id: &str, to: usize, amount: u64) -> Request {
    request(
        id,
        Operation::Deposit {
            to,
            amount,
            min_units: 0,
        },
    )
}
fn total(classes: &[Class]) -> u64 {
    classes.iter().map(|c| c.backing).sum()
}

#[test]
fn fee_floor_cap_disable_and_configuration_bounds() {
    let policy = terms();
    for (gross, fee) in [
        (1, 0),
        (4_999, 0),
        (5_000, 1),
        (10_000_000, 2_000),
        (100_000_000, 20_000),
        (1_000_000_000, 200_000),
        (10_000_000_000, 2_000_000),
        (u64::MAX, 2_000_000),
    ] {
        assert_eq!(policy.fee(gross), Ok(fee));
    }
    assert_eq!(FeeTerms { bps: 0, ..policy }.fee(u64::MAX), Ok(0));
    assert_eq!(FeeTerms { cap: 0, ..policy }.fee(u64::MAX), Ok(0));
    assert_eq!(FeeTerms { bps: 100, ..policy }.fee(100), Ok(1));
    assert_eq!(
        FeeTerms { bps: 101, ..policy }.fee(0),
        Err(MathError::InvalidFeeTerms)
    );
    assert_eq!(
        FeeTerms {
            cap: 2_000_001,
            ..policy
        }
        .fee(0),
        Err(MathError::InvalidFeeTerms)
    );
}

#[test]
fn deposit_mints_net_units_and_preserves_gross_custody() {
    let classes = [class(0)];
    let result =
        batch_with_fees(&classes, &[deposit("entry", 0, 100_000_000)], 1, &[terms()]).unwrap();
    let receipt = &result.receipts[0];
    assert_eq!(receipt.gross, 100_000_000);
    assert_eq!(receipt.fee, 20_000);
    assert_eq!(receipt.fee_version, 7);
    assert_eq!(receipt.minted, 99_980_000 * SCALE as u128);
    assert_eq!(result.classes[0].backing, 99_980_000);
    assert_eq!(result.accepted_deposits, 100_000_000);
    assert_eq!(result.fees, 20_000);
    assert_eq!(
        total(&classes) + result.accepted_deposits,
        total(&result.classes) + result.payable + result.residual + result.fees
    );
}

#[test]
fn capped_redemption_and_switch_deduct_from_source_value_once() {
    let classes = [class(20_000_000_000), class(0)];
    for operation in [
        Operation::Redeem {
            from: 0,
            units: 10_000_000_000 * SCALE as u128,
            min_proceeds: 0,
        },
        Operation::Switch {
            from: 0,
            to: 1,
            units: 10_000_000_000 * SCALE as u128,
            min_units: 0,
        },
    ] {
        let redeem = matches!(operation, Operation::Redeem { .. });
        let result =
            batch_with_fees(&classes, &[request("exit", operation)], 1, &[terms()]).unwrap();
        let receipt = &result.receipts[0];
        assert_eq!(receipt.gross, 10_000_000_000);
        assert_eq!(receipt.fee, 2_000_000);
        assert_eq!(receipt.proceeds, 9_998_000_000);
        assert_eq!(
            receipt.minted,
            if redeem {
                0
            } else {
                9_998_000_000 * SCALE as u128
            }
        );
        assert_eq!(result.payable, if redeem { 9_998_000_000 } else { 0 });
        assert_eq!(
            total(&classes),
            total(&result.classes) + result.payable + result.residual + result.fees
        );
    }
}

#[test]
fn minimums_are_checked_after_fees_and_failures_charge_nothing() {
    let classes = [
        class(100_000_000),
        class(0),
        Class {
            backing: 0,
            units: 1,
        },
    ];
    let requests = [
        request(
            "deposit-min",
            Operation::Deposit {
                to: 1,
                amount: 1_000_000,
                min_units: 1_000_000 * SCALE as u128,
            },
        ),
        request(
            "redeem-min",
            Operation::Redeem {
                from: 0,
                units: 1_000_000 * SCALE as u128,
                min_proceeds: 1_000_000,
            },
        ),
        request(
            "switch-min",
            Operation::Switch {
                from: 0,
                to: 1,
                units: 1_000_000 * SCALE as u128,
                min_units: 1_000_000 * SCALE as u128,
            },
        ),
        deposit("zero-class", 2, 1_000_000),
        Request {
            expiry: 0,
            ..deposit("expired", 1, 1_000_000)
        },
    ];
    let result = batch_with_fees(&classes, &requests, 1, &[terms(); 5]).unwrap();
    assert_eq!(result.classes, classes);
    assert_eq!(result.fees, 0);
    assert_eq!(result.refunds, 3_000_000);
    assert_eq!(
        result
            .receipts
            .iter()
            .map(|r| r.outcome)
            .collect::<Vec<_>>(),
        vec![
            Outcome::ConditionFailed,
            Outcome::ConditionFailed,
            Outcome::ConditionFailed,
            Outcome::ZeroValueClass,
            Outcome::Expired,
        ]
    );
    assert!(result
        .receipts
        .iter()
        .all(|r| r.fee == 0 && r.minted == 0 && r.proceeds == 0));
}

#[test]
fn each_request_uses_its_locked_policy_and_order_does_not_choose_winners() {
    let classes = [class(1_000_000_000), class(0)];
    let requests = [
        deposit("grandfathered", 0, 1_000_000),
        deposit("standard", 0, 1_000_000),
        request(
            "switch",
            Operation::Switch {
                from: 0,
                to: 1,
                units: 1_000_000 * SCALE as u128,
                min_units: 0,
            },
        ),
    ];
    let policies = [
        FeeTerms::default(),
        terms(),
        FeeTerms {
            version: 8,
            bps: 100,
            cap: 10_000,
        },
    ];
    let result = batch_with_fees(&classes, &requests, 1, &policies).unwrap();
    assert_eq!(
        result.receipts.iter().map(|r| r.fee).collect::<Vec<_>>(),
        vec![0, 200, 10_000]
    );
    assert_eq!(
        result
            .receipts
            .iter()
            .map(|r| r.fee_version)
            .collect::<Vec<_>>(),
        vec![0, 7, 8]
    );
    assert_eq!(result.fees, 10_200);
    let reversed = batch_with_fees(
        &classes,
        &requests.into_iter().rev().collect::<Vec<_>>(),
        1,
        &policies.into_iter().rev().collect::<Vec<_>>(),
    )
    .unwrap();
    assert_eq!(result.classes, reversed.classes);
    assert_eq!(result.fees, reversed.fees);
    assert_eq!(result.payable, reversed.payable);
    assert_eq!(result.residual, reversed.residual);
}

#[test]
fn legacy_wrapper_is_zero_fee_and_mismatched_terms_are_rejected() {
    let classes = [class(0)];
    let requests = [deposit("entry", 0, 1_000_000)];
    assert_eq!(
        batch(&classes, &requests, 1),
        batch_with_fees(&classes, &requests, 1, &[FeeTerms::default()])
    );
    assert_eq!(
        batch_with_fees(&classes, &requests, 1, &[]),
        Err(MathError::InvalidFeeTerms)
    );
}
