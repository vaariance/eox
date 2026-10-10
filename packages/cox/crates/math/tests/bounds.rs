use cox_math::*;

#[test]
fn signed_rounding_includes_extremes_without_remainder_doubling_overflow() {
    assert_eq!(rounded_div(5, 2), Ok(3));
    assert_eq!(rounded_div(-5, 2), Ok(-3));
    assert_eq!(rounded_div(i128::MIN, 1), Ok(i128::MIN));
    assert_eq!(rounded_div(i128::MAX - 1, i128::MAX), Ok(1));
    assert_eq!(rounded_div(1, 0), Err(MathError::InvalidDenominator));
}

#[test]
fn practical_supported_pool_envelope_and_outside_overflow_are_explicit() {
    let classes = vec![Class {
        backing: 100_000_000_000,
        units: 100_000_000_000_000_000_000_000,
    }];
    assert_eq!(revalue(&classes, &[1000 * SCALE]).unwrap().classes, classes);
    let excessive = vec![Class {
        backing: u64::MAX,
        units: SCALE as u128,
    }];
    assert_eq!(
        revalue(&excessive, &[SCALE]),
        Err(MathError::ArithmeticOverflow)
    );
}

#[test]
fn ledger_guards_reservations_without_cross_funding_and_failures_are_pure() {
    let ledger = Ledger {
        vault: 100,
        active: 70,
        pending: 20,
        payable: 7,
        residual: 3,
    };
    ledger.validate().unwrap();
    assert!(ledger.withdraw(8).is_err());
    assert!(ledger.refund(21).is_err());
    assert_eq!(ledger.deposit(10).unwrap().pending, 30);
    assert_eq!(ledger.withdraw(7).unwrap().vault, 93);
    assert_eq!(ledger.refund(20).unwrap().vault, 80);
    assert!(Ledger {
        vault: 99,
        ..ledger.clone()
    }
    .validate()
    .is_err());
    assert_eq!(ledger.vault, 100);
}

#[test]
fn full_u128_minimum_rejects_by_condition_and_duplicate_ids_are_invalid() {
    let classes = [Class {
        backing: 10,
        units: 10 * SCALE as u128,
    }];
    let request = Request {
        id: "a".into(),
        expiry: 1,
        operation: Operation::Deposit {
            to: 0,
            amount: 1,
            min_units: u128::MAX,
        },
    };
    assert_eq!(
        batch(&classes, std::slice::from_ref(&request), 1)
            .unwrap()
            .receipts[0]
            .outcome,
        Outcome::ConditionFailed
    );
    assert_eq!(
        batch(&classes, &[request.clone(), request], 1),
        Err(MathError::DuplicateRequest)
    );
}

#[test]
fn empty_class_deposit_cannot_create_an_immediately_unredeemable_state() {
    let empty = [Class {
        backing: 0,
        units: 0,
    }];
    let deposit = Request {
        id: "large".into(),
        expiry: 1,
        operation: Operation::Deposit {
            to: 0,
            amount: 100_000_000_000_000,
            min_units: 0,
        },
    };
    assert_eq!(
        batch(&empty, &[deposit], 1),
        Err(MathError::ArithmeticOverflow)
    );
    let deposit = Request {
        id: "supported".into(),
        expiry: 1,
        operation: Operation::Deposit {
            to: 0,
            amount: 100_000_000_000,
            min_units: 0,
        },
    };
    let entered = batch(&empty, &[deposit], 1).unwrap();
    let marked = revalue(&entered.classes, &[SCALE]).unwrap();
    let exit = Request {
        id: "exit".into(),
        expiry: 2,
        operation: Operation::Redeem {
            from: 0,
            units: marked.classes[0].units,
            min_proceeds: 0,
        },
    };
    assert_eq!(
        batch(&marked.classes, &[exit], 2).unwrap().payable,
        100_000_000_000
    );
}
