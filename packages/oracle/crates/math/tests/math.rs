use eox_oracle_math::*;
fn rule() -> Rule {
    Rule {
        series_id: [4; 32],
        transform: Transform::Identity,
        normalization: Normalization::Directional {
            lower: -SCALE,
            upper: SCALE,
            direction: 1,
        },
        weight: 1,
        unit: [1; 32],
        source: [2; 32],
        source_authority: 10_000,
        comparison_period_delta: 0,
        grace_seconds: 30,
        zero_seconds: 90,
    }
}
fn evidence() -> Evidence {
    Evidence {
        record_id: [3; 32],
        series_id: [4; 32],
        artifact_digest: [5; 32],
        metadata_digest: [6; 32],
        unit: [1; 32],
        source: [2; 32],
        value: 0,
        published_at: Some(100),
        known_at: Some(100),
        recorded_at: 101,
        period: 2,
        quality: [10_000; 8],
    }
}
fn state(value: i64) -> CountryResult {
    CountryResult {
        state: value,
        confidence: SCALE,
        saturated: false,
        stale: false,
    }
}
#[test]
fn baseline_and_example() {
    let a = state(100_150_000);
    let b = state(99_850_000);
    let w = world(&[a.clone(), b]).unwrap();
    assert_eq!(w.state, 100 * SCALE);
    assert_eq!(
        reference(&a, &w, 100 * SCALE, 100 * SCALE, 20)
            .unwrap()
            .expressed,
        103 * SCALE
    );
    assert_eq!(
        reference(&a, &w, a.state, w.state, 20).unwrap().expressed,
        100 * SCALE
    );
}
#[test]
fn proportional_movement_is_zero() {
    assert_eq!(
        reference(
            &state(120 * SCALE),
            &state(90 * SCALE),
            100 * SCALE,
            75 * SCALE,
            20
        )
        .unwrap()
        .change,
        0
    );
}
#[test]
fn third_country_cancels_and_pair_reciprocal() {
    let us = state(110 * SCALE);
    let jp = state(100 * SCALE);
    let w1 = world(&[us.clone(), jp.clone(), state(100 * SCALE)]).unwrap();
    let w2 = world(&[us.clone(), jp.clone(), state(140 * SCALE)]).unwrap();
    assert_ne!(
        reference(&us, &w1, 100 * SCALE, 100 * SCALE, 20).unwrap(),
        reference(&us, &w2, 100 * SCALE, 100 * SCALE, 20).unwrap()
    );
    let p = reference(&us, &jp, 100 * SCALE, 100 * SCALE, 20).unwrap();
    let reverse = reference(&jp, &us, 100 * SCALE, 100 * SCALE, 20).unwrap();
    assert_eq!(p.change, 100_000);
    assert_eq!(reverse.change, -90_909);
    assert_ne!(p.change, -reverse.change);
}
#[test]
fn signed_reference_is_not_floored() {
    assert!(
        reference(
            &state(50 * SCALE),
            &state(150 * SCALE),
            100 * SCALE,
            100 * SCALE,
            20
        )
        .unwrap()
        .expressed
            < 0
    );
}
#[test]
fn exact_decimal_boundary() {
    assert_eq!(parse_decimal("-1.000001000"), Ok(-1_000_001));
    assert_eq!(parse_decimal("1000000000000"), Ok(MAX_VALUE));
    for bad in [
        "1.0000001",
        "NaN",
        "1e6",
        "",
        "-",
        ".1",
        "1..2",
        "+1",
        "1000000000001",
    ] {
        assert!(parse_decimal(bad).is_err(), "{bad}");
    }
}
#[test]
fn signed_rounding() {
    assert_eq!(rounded_div(5, 2), Ok(3));
    assert_eq!(rounded_div(-5, 2), Ok(-3));
    assert_eq!(rounded_div(-4, 3), Ok(-1));
    assert_eq!(rounded_div(1, 0), Err(MathError::InvalidDenominator));
    assert!(rounded_div(i128::MIN, 3).is_ok());
}
#[test]
fn freshness_only_changes_confidence() {
    let r = rule();
    let s = Slot {
        current: evidence(),
        comparison: None,
    };
    let fresh = calculate_indicator(&r, &s, 110, &History::default(), &History::default()).unwrap();
    let old = calculate_indicator(&r, &s, 160, &History::default(), &History::default()).unwrap();
    assert_eq!(fresh.normalized, old.normalized);
    assert_eq!(fresh.confidence, SCALE);
    assert_eq!(old.confidence, SCALE / 2);
    let stale = calculate_indicator(&r, &s, 190, &History::default(), &History::default()).unwrap();
    assert_eq!(stale.confidence, 0);
    assert!(stale.stale);
}
#[test]
fn penalties_and_quality_order() {
    let r = rule();
    let e = evidence();
    assert_eq!(
        confidence(
            &r,
            &e,
            110,
            &History {
                pending: 1,
                rejected: 1
            }
        )
        .unwrap()
        .0,
        750_000
    );
    assert_eq!(
        confidence(
            &r,
            &e,
            110,
            &History {
                pending: 0,
                rejected: 100
            }
        )
        .unwrap()
        .0,
        800_000
    );
    assert_eq!(
        confidence(
            &r,
            &e,
            110,
            &History {
                pending: u32::MAX,
                rejected: u32::MAX
            }
        )
        .unwrap()
        .0,
        0
    );
    let mut e = e;
    e.quality[1] = 5000;
    assert_eq!(
        confidence(&r, &e, 110, &History::default()).unwrap().0,
        500_000
    );
}
#[test]
fn source_quality_is_not_proposer_override() {
    let r = rule();
    let mut e = evidence();
    e.quality[0] = 9000;
    assert_eq!(
        confidence(&r, &e, 110, &History::default()),
        Err(MathError::InvalidQuality)
    );
}
#[test]
fn invalid_publication_and_period() {
    let mut e = evidence();
    e.published_at = None;
    assert_eq!(
        confidence(&rule(), &e, 110, &History::default()),
        Err(MathError::MissingPublicationTime)
    );
    e.published_at = Some(111);
    assert_eq!(
        confidence(&rule(), &e, 110, &History::default()),
        Err(MathError::FuturePublicationTime)
    );
    let mut r = rule();
    r.transform = Transform::FractionalChange;
    r.comparison_period_delta = 1;
    let s = Slot {
        current: evidence(),
        comparison: Some(evidence()),
    };
    assert_eq!(validate_slot(&r, &s, 110), Err(MathError::InvalidPeriod));
}
#[test]
fn transforms_and_comparison_confidence() {
    let mut r = rule();
    r.transform = Transform::FractionalChange;
    r.comparison_period_delta = 1;
    let mut current = evidence();
    current.value = 110 * SCALE;
    let mut baseline = evidence();
    baseline.value = 100 * SCALE;
    baseline.period = 1;
    baseline.quality[1] = 5000;
    let mut slot = Slot {
        current,
        comparison: Some(baseline),
    };
    assert_eq!(transform(&r, &slot), Ok(100_000));
    assert_eq!(
        calculate_indicator(&r, &slot, 110, &History::default(), &History::default())
            .unwrap()
            .confidence,
        500_000
    );
    slot.comparison.as_mut().unwrap().value = 0;
    assert_eq!(
        validate_slot(&r, &slot, 110),
        Err(MathError::InvalidDenominator)
    );
}
#[test]
fn saturation_and_target() {
    let r = rule();
    assert_eq!(normalize(&r, 2 * SCALE), Ok((SCALE, true)));
    assert_eq!(normalize(&r, -SCALE), Ok((-SCALE, true)));
    let mut r = r;
    r.normalization = Normalization::Target {
        target: 0,
        distance: SCALE,
    };
    assert_eq!(normalize(&r, 0), Ok((SCALE, true)));
    assert_eq!(normalize(&r, SCALE / 2), Ok((0, false)));
    assert_eq!(normalize(&r, SCALE), Ok((-SCALE, true)));
}
#[test]
fn digest_changes_and_domains() {
    let e = evidence();
    let before = evidence_digest(&e).unwrap();
    let mut revised = e.clone();
    revised.quality[2] = 9000;
    assert_ne!(before, evidence_digest(&revised).unwrap());
    assert_ne!(digest("a", &e).unwrap(), digest("b", &e).unwrap());
    assert_eq!(before, evidence_digest(&e).unwrap());
}
#[test]
fn maximum_universe_and_weighted_bounds() {
    let i = IndicatorResult {
        normalized: SCALE,
        confidence: SCALE,
        saturated: true,
        stale: false,
    };
    let c = country(&vec![(i, 10_000); 32]).unwrap();
    assert_eq!(c.state, 150 * SCALE);
    let w = world(&vec![c; 30]).unwrap();
    assert_eq!(w.state, 150 * SCALE);
}
#[test]
fn normalization_monotonic_property() {
    let r = rule();
    let mut last = -SCALE;
    for x in (-2_000_000..=2_000_000).step_by(1234) {
        let (z, _) = normalize(&r, x).unwrap();
        assert!(z >= last);
        assert!((-SCALE..=SCALE).contains(&z));
        last = z;
    }
}
#[test]
fn series_cannot_be_substituted() {
    let r = rule();
    let mut e = evidence();
    e.series_id = [99; 32];
    assert_eq!(
        validate_slot(
            &r,
            &Slot {
                current: e,
                comparison: None
            },
            110
        ),
        Err(MathError::InvalidIdentity)
    );
}
#[test]
fn decimal_roundtrip_property() {
    for value in (-10_000_000i64..10_000_000).step_by(997) {
        let sign = if value < 0 { "-" } else { "" };
        let n = value.abs();
        let encoded = format!("{sign}{}.{:06}", n / SCALE, n % SCALE);
        assert_eq!(parse_decimal(&encoded), Ok(value));
    }
}
#[test]
fn normalized_country_never_exits_bounds() {
    for z in (-SCALE..=SCALE).step_by(997) {
        let result = country(&[(
            IndicatorResult {
                normalized: z,
                confidence: SCALE / 2,
                saturated: false,
                stale: false,
            },
            1,
        )])
        .unwrap();
        assert!((50 * SCALE..=150 * SCALE).contains(&result.state));
        assert_eq!(result.confidence, SCALE / 2);
    }
}

#[test]
fn transport_metadata_cannot_reset_challenge_identity() {
    let a = evidence();
    let mut b = a.clone();
    b.record_id = [99; 32];
    b.known_at = Some(200);
    b.recorded_at += 100;
    assert_eq!(evidence_digest(&a).unwrap(), evidence_digest(&b).unwrap());
    assert_ne!(
        digest("snapshot-evidence", &a).unwrap(),
        digest("snapshot-evidence", &b).unwrap()
    );
}
#[test]
fn amplified_reference_does_not_amplify_rounded_change() {
    let a = state(100 * SCALE + 1);
    let b = state(100 * SCALE);
    let r = reference(&a, &b, 100 * SCALE, 100 * SCALE, 20).unwrap();
    assert_eq!(r.change, 0);
    assert_eq!(r.expressed, 100 * SCALE + 20);
}
#[test]
fn extremes_stay_in_checked_integer_range() {
    let up = reference(
        &state(150 * SCALE),
        &state(50 * SCALE),
        50 * SCALE,
        150 * SCALE,
        100,
    )
    .unwrap();
    assert_eq!(up.change, 8 * SCALE);
    assert_eq!(up.expressed, 80100 * SCALE);
    let r = rule();
    assert_eq!(normalize(&r, MAX_VALUE), Ok((SCALE, true)));
    assert_eq!(normalize(&r, -MAX_VALUE), Ok((-SCALE, true)));
}
#[test]
fn nullable_source_known_time_is_valid() {
    let mut e = evidence();
    e.known_at = None;
    assert!(validate_slot(
        &rule(),
        &Slot {
            current: e,
            comparison: None
        },
        110
    )
    .is_ok());
}
#[test]
fn metadata_is_bound_but_does_not_reset_source_history() {
    let a = evidence();
    let mut b = a.clone();
    b.metadata_digest = [44; 32];
    assert_eq!(evidence_digest(&a).unwrap(), evidence_digest(&b).unwrap());
    assert_ne!(
        digest("snapshot-evidence", &a).unwrap(),
        digest("snapshot-evidence", &b).unwrap()
    );
    let metadata = Metadata {
        country: "US".into(),
        indicator: "gdp".into(),
        revision_id: "v1".into(),
        manifest: "source.json".into(),
        supersedes: None,
        comparison_record_id: None,
    };
    let mut revised = metadata.clone();
    revised.revision_id = "v2".into();
    assert_ne!(
        metadata_digest(&metadata).unwrap(),
        metadata_digest(&revised).unwrap()
    );
}

#[test]
fn semantic_digest_golden() {
    assert_eq!(
        evidence_digest(&evidence()).unwrap(),
        [
            160, 120, 114, 247, 201, 98, 71, 1, 123, 77, 86, 222, 36, 163, 79, 67, 244, 119, 101,
            253, 213, 255, 101, 164, 13, 160, 37, 182, 159, 161, 84, 142
        ]
    );
}
