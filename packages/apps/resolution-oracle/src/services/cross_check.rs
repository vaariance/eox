use crate::engine::Wad;
use crate::error::OracleError;
use crate::types::Observation;

#[derive(Debug, PartialEq, Eq)]
pub enum CrossCheckOutcome {
    NoDispute,
    Dispute { mirror_source: String },
    ClaimLoses,
}

pub fn cross_check(
    claimed: &Observation,
    official_value: &str,
    mirrors: &[Observation],
    tolerance: Wad,
) -> Result<CrossCheckOutcome, OracleError> {
    let official = Wad::from_decimal_str(official_value)?;
    if Wad::from_decimal_str(&claimed.value)? != official {
        return Ok(CrossCheckOutcome::ClaimLoses);
    }

    for mirror in mirrors {
        let comparable = mirror.country_iso3 == claimed.country_iso3
            && mirror.indicator_id == claimed.indicator_id
            && mirror.period_start == claimed.period_start
            && mirror.period_end == claimed.period_end
            && mirror.vintage == claimed.vintage
            && mirror.known_at >= claimed.known_at;
        if !comparable {
            continue;
        }
        let gap = Wad::from_decimal_str(&mirror.value)?
            .checked_sub(official)?
            .0
            .unsigned_abs();
        if gap > tolerance.0.unsigned_abs() {
            return Ok(CrossCheckOutcome::Dispute {
                mirror_source: mirror.source_id.clone(),
            });
        }
    }
    Ok(CrossCheckOutcome::NoDispute)
}
