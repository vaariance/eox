use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";

#[constant]
pub const EPOCH_SEED: &[u8] = b"epoch";

const SECONDS_PER_DAY: i64 = 86_400;

/// How long after the cutoff a relayed result is accepted. The EVM adapter stops taking
/// assertions 21 days after the cutoff; with UMA's 72-hour liveness, a dispute and the vote,
/// the last possible result lands well inside this. After it, anyone may void the epoch.
pub const RESULT_DEADLINE: i64 = 35 * SECONDS_PER_DAY;

/// An epoch is a calendar year; its evidence cutoff is 31 July of the following year, 00:00 UTC.
pub fn cutoff_timestamp(epoch_year: u16) -> i64 {
    days_from_civil(i64::from(epoch_year) + 1, 7, 31) * SECONDS_PER_DAY
}

// Days since 1970-01-01 in the proleptic Gregorian calendar (Howard Hinnant's algorithm),
// valid for years >= 0.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y / 400;
    let year_of_era = y - era * 400;
    let month_index = if month > 2 { month - 3 } else { month + 9 };
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cutoff_is_31_july_of_the_following_year() {
        // Same values the EVM adapter's tests pin.
        assert_eq!(cutoff_timestamp(2025), 1_785_456_000);
        assert_eq!(cutoff_timestamp(1969), 18_230_400);
        assert_eq!(cutoff_timestamp(2027) - cutoff_timestamp(2026), 366 * SECONDS_PER_DAY);
    }

    #[test]
    fn the_last_possible_uma_result_lands_before_the_deadline() {
        // Assertion window, liveness, then a dispute: UMA's vote takes roughly 2-4 days.
        let latest = 21 * SECONDS_PER_DAY + 3 * SECONDS_PER_DAY + 7 * SECONDS_PER_DAY;
        assert!(latest < RESULT_DEADLINE);
    }
}
