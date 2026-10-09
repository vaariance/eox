//! EOX v0.1 deterministic, experimental index mathematics. All monetary-looking
//! outputs are index values, never collateral entitlements or USDC prices.
pub mod protocol;
use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};
#[cfg(not(target_os = "solana"))]
use sha2::{Digest, Sha256};

pub const SCALE: i64 = 1_000_000;
pub const MAX_VALUE: i64 = 1_000_000_000_000_000_000;
pub type Hash = [u8; 32];
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MathError {
    Overflow,
    InvalidConfiguration,
    InvalidValue,
    MissingPublicationTime,
    FuturePublicationTime,
    InvalidPeriod,
    InvalidIdentity,
    InvalidQuality,
    InvalidDenominator,
    MissingComparison,
    UnexpectedComparison,
    Encoding,
}
impl std::fmt::Display for MathError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for MathError {}
pub type Result<T> = std::result::Result<T, MathError>;
macro_rules! model { ($($item:item)*) => { $(#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize, Serialize, Deserialize)] $item)* }; }
model! {
    pub enum Transform { Identity, Difference, FractionalChange }
    pub enum Normalization { Directional { lower:i64, upper:i64, direction:i8 }, Target { target:i64, distance:i64 } }
    pub struct Rule { pub series_id:Hash, pub transform:Transform, pub normalization:Normalization, pub weight:u16, pub unit:Hash, pub source:Hash, pub source_authority:u16, pub comparison_period_delta:i64, pub grace_seconds:i64, pub zero_seconds:i64 }
    pub struct Evidence { pub record_id:Hash, pub series_id:Hash, pub artifact_digest:Hash, pub metadata_digest:Hash, pub unit:Hash, pub source:Hash, pub value:i64, pub published_at:Option<i64>, pub known_at:Option<i64>, pub recorded_at:i64, pub period:i64, pub quality:[u16;8] }
    pub struct Slot { pub current:Evidence, pub comparison:Option<Evidence> }
    pub struct Metadata { pub country:String, pub indicator:String, pub revision_id:String, pub manifest:String, pub supersedes:Option<String>, pub comparison_record_id:Option<String> }
    pub struct History { pub pending:u32, pub rejected:u32 }
    pub struct IndicatorResult { pub normalized:i64, pub confidence:i64, pub saturated:bool, pub stale:bool }
    pub struct CountryResult { pub state:i64, pub confidence:i64, pub saturated:bool, pub stale:bool }
    pub struct Reference { pub ratio:i64, pub change:i64, pub expressed:i64, pub confidence:i64 }
    pub struct CountryInput { pub id:String, pub rules:Vec<Rule>, pub slots:Vec<Slot>, pub histories:Vec<[History;2]> }
    pub struct PreviewInput { pub evaluation_time:i64, pub multiplier:u16, pub countries:Vec<CountryInput>, pub baseline:Option<Vec<i64>> }
    pub struct PreviewOutput { pub countries:Vec<CountryResult>, pub world:CountryResult, pub references:Vec<Reference>, pub baseline:Vec<i64>, pub evidence_digest:Hash }
}
impl Default for History {
    fn default() -> Self {
        Self {
            pending: 0,
            rejected: 0,
        }
    }
}

/// Signed nearest rounding with ties away from zero; never uses floating point.
pub fn rounded_div(n: i128, d: i128) -> Result<i128> {
    if d <= 0 {
        return Err(MathError::InvalidDenominator);
    }
    let q = n / d;
    let r = n % d;
    let twice = r
        .checked_abs()
        .and_then(|v| v.checked_mul(2))
        .ok_or(MathError::Overflow)?;
    if twice >= d {
        q.checked_add(if n < 0 { -1 } else { 1 })
            .ok_or(MathError::Overflow)
    } else {
        Ok(q)
    }
}
fn narrow(n: i128) -> Result<i64> {
    i64::try_from(n).map_err(|_| MathError::Overflow)
}
fn div(n: i128, d: i128) -> Result<i64> {
    narrow(rounded_div(n, d)?)
}
fn bounded(v: i64) -> Result<()> {
    if !(-MAX_VALUE..=MAX_VALUE).contains(&v) {
        Err(MathError::InvalidValue)
    } else {
        Ok(())
    }
}
pub fn multiply(a: i64, b: i64) -> Result<i64> {
    div(
        (a as i128)
            .checked_mul(b as i128)
            .ok_or(MathError::Overflow)?,
        SCALE as i128,
    )
}

pub fn validate_rule(r: &Rule) -> Result<()> {
    if r.weight == 0
        || r.weight > 10_000
        || r.source_authority > 10_000
        || r.grace_seconds < 0
        || r.zero_seconds <= r.grace_seconds
    {
        return Err(MathError::InvalidConfiguration);
    }
    match r.transform {
        Transform::Identity => {
            if r.comparison_period_delta != 0 {
                return Err(MathError::InvalidConfiguration);
            }
        }
        _ => {
            if r.comparison_period_delta <= 0 {
                return Err(MathError::InvalidConfiguration);
            }
        }
    }
    match r.normalization {
        Normalization::Directional {
            lower,
            upper,
            direction,
        } => {
            bounded(lower)?;
            bounded(upper)?;
            if upper <= lower || (direction != 1 && direction != -1) {
                return Err(MathError::InvalidConfiguration);
            }
        }
        Normalization::Target { target, distance } => {
            bounded(target)?;
            bounded(distance)?;
            if distance <= 0 {
                return Err(MathError::InvalidConfiguration);
            }
        }
    }
    Ok(())
}
fn validate_evidence(r: &Rule, e: &Evidence, t: i64) -> Result<()> {
    bounded(e.value)?;
    let p = e.published_at.ok_or(MathError::MissingPublicationTime)?;
    if p < 0 || e.known_at.is_some_and(|t| t < 0) || e.recorded_at < 0 || t < 0 {
        return Err(MathError::InvalidValue);
    }
    if p > t {
        return Err(MathError::FuturePublicationTime);
    }
    if e.series_id != r.series_id || e.unit != r.unit || e.source != r.source {
        return Err(MathError::InvalidIdentity);
    }
    if e.quality.iter().any(|v| *v > 10_000) || e.quality[0] != r.source_authority {
        return Err(MathError::InvalidQuality);
    }
    Ok(())
}
pub fn validate_slot(r: &Rule, s: &Slot, t: i64) -> Result<()> {
    validate_rule(r)?;
    validate_evidence(r, &s.current, t)?;
    match (&r.transform, &s.comparison) {
        (Transform::Identity, None) => {}
        (Transform::Identity, Some(_)) => return Err(MathError::UnexpectedComparison),
        (_, None) => return Err(MathError::MissingComparison),
        (_, Some(b)) => {
            validate_evidence(r, b, t)?;
            if s.current.series_id != b.series_id
                || s.current.period.checked_sub(b.period) != Some(r.comparison_period_delta)
            {
                return Err(MathError::InvalidPeriod);
            }
            if matches!(r.transform, Transform::FractionalChange) && b.value <= 0 {
                return Err(MathError::InvalidDenominator);
            }
        }
    }
    Ok(())
}
pub fn transform(r: &Rule, s: &Slot) -> Result<i64> {
    let v = s.current.value as i128;
    let x = match r.transform {
        Transform::Identity => s.current.value,
        Transform::Difference => narrow(
            v - s
                .comparison
                .as_ref()
                .ok_or(MathError::MissingComparison)?
                .value as i128,
        )?,
        Transform::FractionalChange => {
            let b = s
                .comparison
                .as_ref()
                .ok_or(MathError::MissingComparison)?
                .value as i128;
            div(
                (v - b)
                    .checked_mul(SCALE as i128)
                    .ok_or(MathError::Overflow)?,
                b,
            )?
        }
    };
    bounded(x)?;
    Ok(x)
}
pub fn normalize(r: &Rule, x: i64) -> Result<(i64, bool)> {
    validate_rule(r)?;
    bounded(x)?;
    let z = match r.normalization {
        Normalization::Directional {
            lower,
            upper,
            direction,
        } => {
            let term = rounded_div(
                2 * (x as i128 - lower as i128) * SCALE as i128,
                upper as i128 - lower as i128,
            )?;
            (term - SCALE as i128) * direction as i128
        }
        Normalization::Target { target, distance } => {
            SCALE as i128
                - rounded_div(
                    2 * (x as i128 - target as i128).abs() * SCALE as i128,
                    distance as i128,
                )?
        }
    };
    Ok((
        z.clamp(-(SCALE as i128), SCALE as i128) as i64,
        z <= -(SCALE as i128) || z >= SCALE as i128,
    ))
}
pub fn confidence(r: &Rule, e: &Evidence, t: i64, h: &History) -> Result<(i64, bool)> {
    validate_rule(r)?;
    validate_evidence(r, e, t)?;
    let mut q = SCALE;
    for factor in e.quality {
        q = multiply(q, factor as i64 * 100)?;
    }
    let age = t - e.published_at.ok_or(MathError::MissingPublicationTime)?;
    let f = if age <= r.grace_seconds {
        SCALE
    } else if age >= r.zero_seconds {
        0
    } else {
        div(
            (r.zero_seconds - age) as i128 * SCALE as i128,
            (r.zero_seconds - r.grace_seconds) as i128,
        )?
    };
    let rejected = (h.rejected as i64 * 50_000).min(200_000);
    let pending = (h.pending as i64 * 200_000).min(800_000);
    let d = (SCALE - rejected - pending).max(0);
    Ok((multiply(multiply(q, f)?, d)?, f == 0))
}
pub fn calculate_indicator(
    r: &Rule,
    s: &Slot,
    t: i64,
    current_history: &History,
    comparison_history: &History,
) -> Result<IndicatorResult> {
    validate_slot(r, s, t)?;
    let (normalized, saturated) = normalize(r, transform(r, s)?)?;
    let (mut c, mut stale) = confidence(r, &s.current, t, current_history)?;
    if let Some(b) = &s.comparison {
        let (bc, bs) = confidence(r, b, t, comparison_history)?;
        c = c.min(bc);
        stale |= bs;
    }
    Ok(IndicatorResult {
        normalized,
        confidence: c,
        saturated,
        stale,
    })
}
pub fn country(items: &[(IndicatorResult, u16)]) -> Result<CountryResult> {
    if items.is_empty() || items.len() > 32 {
        return Err(MathError::InvalidConfiguration);
    }
    let mut sum = 0i128;
    let mut conf = 0i128;
    let mut weights = 0i128;
    for (x, w) in items {
        if *w == 0
            || *w > 10_000
            || !(-SCALE..=SCALE).contains(&x.normalized)
            || !(0..=SCALE).contains(&x.confidence)
        {
            return Err(MathError::InvalidValue);
        }
        sum += x.normalized as i128 * (*w as i128);
        conf += x.confidence as i128 * (*w as i128);
        weights += *w as i128;
    }
    let z = div(sum, weights)?;
    Ok(CountryResult {
        state: 100 * SCALE + 50 * z,
        confidence: div(conf, weights)?,
        saturated: items.iter().any(|(x, _)| x.saturated),
        stale: items.iter().any(|(x, _)| x.stale),
    })
}
pub fn world(items: &[CountryResult]) -> Result<CountryResult> {
    if !(2..=30).contains(&items.len()) {
        return Err(MathError::InvalidConfiguration);
    }
    if items.iter().any(|x| {
        !(50 * SCALE..=150 * SCALE).contains(&x.state) || !(0..=SCALE).contains(&x.confidence)
    }) {
        return Err(MathError::InvalidValue);
    }
    Ok(CountryResult {
        state: div(
            items.iter().map(|x| x.state as i128).sum(),
            items.len() as i128,
        )?,
        confidence: div(
            items.iter().map(|x| x.confidence as i128).sum(),
            items.len() as i128,
        )?,
        saturated: items.iter().any(|x| x.saturated),
        stale: items.iter().any(|x| x.stale),
    })
}
/// Also calculates country/country references: WORLD cancels algebraically.
pub fn reference(
    a: &CountryResult,
    b: &CountryResult,
    baseline_a: i64,
    baseline_b: i64,
    multiplier: u16,
) -> Result<Reference> {
    if !(0..=SCALE).contains(&a.confidence)
        || !(0..=SCALE).contains(&b.confidence)
        || !(1..=100).contains(&multiplier)
        || [a.state, b.state, baseline_a, baseline_b]
            .iter()
            .any(|v| !(50 * SCALE..=150 * SCALE).contains(v))
    {
        return Err(MathError::InvalidConfiguration);
    }
    let den = b.state as i128 * baseline_a as i128;
    let num = a.state as i128 * baseline_b as i128 - den;
    Ok(Reference {
        ratio: div(a.state as i128 * SCALE as i128, b.state as i128)?,
        change: div(num * SCALE as i128, den)?,
        expressed: div(100 * SCALE as i128 * (den + multiplier as i128 * num), den)?,
        confidence: a.confidence.min(b.confidence),
    })
}
/// Borsh encoding is canonical; the domain and its length prevent cross-use.
pub fn digest<T: BorshSerialize>(domain: &str, value: &T) -> Result<Hash> {
    let bytes = value.try_to_vec().map_err(|_| MathError::Encoding)?;
    Ok(hash_parts(&[
        b"EOX/ORACLE/V1\0",
        &(domain.len() as u32).to_le_bytes(),
        domain.as_bytes(),
        &bytes,
    ]))
}
fn hash_parts(parts: &[&[u8]]) -> Hash {
    #[cfg(target_os = "solana")]
    {
        solana_sha256_hasher::hashv(parts).to_bytes()
    }
    #[cfg(not(target_os = "solana"))]
    {
        let mut hash = Sha256::new();
        for part in parts {
            hash.update(part);
        }
        hash.finalize().into()
    }
}
/// Stable identity of the asserted source content. Transport metadata cannot
/// clear challenge history; the full Evidence remains in the snapshot hash.
pub fn evidence_digest(e: &Evidence) -> Result<Hash> {
    digest(
        "evidence",
        &(
            &e.series_id,
            &e.artifact_digest,
            &e.unit,
            &e.source,
            e.value,
            e.published_at,
            e.period,
            &e.quality,
        ),
    )
}
pub fn metadata_digest(metadata: &Metadata) -> Result<Hash> {
    digest("evidence-metadata", metadata)
}
/// Raw SHA-256 for provider artifact bytes (not a protocol commitment).
pub fn artifact_digest(bytes: &[u8]) -> Hash {
    hash_parts(&[bytes])
}
/// Lossless decimal adaptation at the integration boundary.
pub fn parse_decimal(s: &str) -> Result<i64> {
    let (negative, s) = if let Some(rest) = s.strip_prefix('-') {
        (true, rest)
    } else {
        (false, s)
    };
    let mut parts = s.split('.');
    let whole = parts.next().ok_or(MathError::InvalidValue)?;
    let fraction = parts.next().unwrap_or("");
    if parts.next().is_some()
        || whole.is_empty()
        || !whole.bytes().all(|b| b.is_ascii_digit())
        || !fraction.bytes().all(|b| b.is_ascii_digit())
    {
        return Err(MathError::InvalidValue);
    }
    let significant = fraction.trim_end_matches('0');
    if significant.len() > 6 {
        return Err(MathError::InvalidValue);
    }
    let integer = whole.parse::<i128>().map_err(|_| MathError::InvalidValue)?;
    let fractional = if significant.is_empty() {
        0
    } else {
        significant
            .parse::<i128>()
            .map_err(|_| MathError::InvalidValue)?
            * 10i128.pow((6 - significant.len()) as u32)
    };
    let value = integer
        .checked_mul(SCALE as i128)
        .and_then(|x| x.checked_add(fractional))
        .ok_or(MathError::Overflow)?;
    let value = narrow(if negative { -value } else { value })?;
    bounded(value)?;
    Ok(value)
}
pub fn preview(input: &PreviewInput) -> Result<PreviewOutput> {
    if !(2..=30).contains(&input.countries.len()) {
        return Err(MathError::InvalidConfiguration);
    }
    let mut countries = Vec::new();
    let mut ids = std::collections::BTreeSet::new();
    for c in &input.countries {
        if c.id.is_empty() || c.id.len() > 16 || !ids.insert(c.id.clone()) {
            return Err(MathError::InvalidIdentity);
        }
        if c.rules.len() != c.slots.len() || c.rules.len() != c.histories.len() {
            return Err(MathError::InvalidConfiguration);
        }
        let mut indicators = Vec::new();
        for ((r, s), h) in c.rules.iter().zip(&c.slots).zip(&c.histories) {
            indicators.push((
                calculate_indicator(r, s, input.evaluation_time, &h[0], &h[1])?,
                r.weight,
            ));
        }
        countries.push(country(&indicators)?);
    }
    let w = world(&countries)?;
    let baseline = input
        .baseline
        .clone()
        .unwrap_or_else(|| countries.iter().map(|x| x.state).collect());
    if baseline.len() != countries.len() {
        return Err(MathError::InvalidConfiguration);
    }
    let baseline_w = world(
        &baseline
            .iter()
            .map(|state| CountryResult {
                state: *state,
                confidence: SCALE,
                saturated: false,
                stale: false,
            })
            .collect::<Vec<_>>(),
    )?
    .state;
    let references = countries
        .iter()
        .zip(&baseline)
        .map(|(c, b)| reference(c, &w, *b, baseline_w, input.multiplier))
        .collect::<Result<Vec<_>>>()?;
    Ok(PreviewOutput {
        countries,
        world: w,
        references,
        baseline,
        evidence_digest: digest("preview-input", input)?,
    })
}
