use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";

#[constant]
pub const EPOCH_SEED: &[u8] = b"epoch";

const SECONDS_PER_DAY: i64 = 86_400;

pub const RESULT_DEADLINE: i64 = 35 * SECONDS_PER_DAY;

pub fn cutoff_timestamp(epoch_year: u16) -> i64 {
    days_from_civil(i64::from(epoch_year) + 1, 7, 31) * SECONDS_PER_DAY
}

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
        assert_eq!(cutoff_timestamp(2025), 1_785_456_000);
        assert_eq!(cutoff_timestamp(1969), 18_230_400);
        assert_eq!(cutoff_timestamp(2027) - cutoff_timestamp(2026), 366 * SECONDS_PER_DAY);
    }

    #[test]
    fn the_last_possible_uma_result_lands_before_the_deadline() {
        let latest = 21 * SECONDS_PER_DAY + 3 * SECONDS_PER_DAY + 7 * SECONDS_PER_DAY;
        assert!(latest < RESULT_DEADLINE);
    }
}
