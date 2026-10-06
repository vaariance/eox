use crate::error::EngineError;
use std::fmt;

pub const WAD: i128 = 1_000_000_000_000_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct Wad(pub i128);

fn mul_u128_to_u256(a: u128, b: u128) -> [u64; 4] {
    let a0 = a as u64 as u128;
    let a1 = a >> 64;
    let b0 = b as u64 as u128;
    let b1 = b >> 64;

    let p0 = a0 * b0;
    let p1 = a0 * b1;
    let p2 = a1 * b0;
    let p3 = a1 * b1;

    let c0 = p0 as u64;
    let carry0 = p0 >> 64;

    let sum1 = carry0 + (p1 as u64 as u128) + (p2 as u64 as u128);
    let c1 = sum1 as u64;
    let carry1 = (sum1 >> 64) + (p1 >> 64) + (p2 >> 64);

    let sum2 = carry1 + p3;
    let c2 = sum2 as u64;
    let c3 = (sum2 >> 64) as u64;

    [c0, c1, c2, c3]
}

fn div_u256_by_u64(c: [u64; 4], d: u64) -> ([u64; 4], u64) {
    let d = d as u128;
    let mut rem = 0u128;
    let mut q = [0u64; 4];
    for i in (0..4).rev() {
        let cur = (rem << 64) | (c[i] as u128);
        q[i] = (cur / d) as u64;
        rem = cur % d;
    }
    (q, rem as u64)
}

fn div_u256_by_u128(c: [u64; 4], b: u128) -> Option<(u128, u128)> {
    if b == 0 {
        return None;
    }
    let mut rem = 0u128;
    let mut q = 0u128;

    for i in (0..256).rev() {
        let limb_idx = i / 64;
        let bit_idx = i % 64;
        let bit = ((c[limb_idx] >> bit_idx) & 1) as u128;

        rem = (rem << 1) | bit;
        if rem >= b {
            rem -= b;
            if i >= 128 {
                return None;
            }
            q |= 1u128 << i;
        }
    }

    Some((q, rem))
}

fn u256_le(a: [u64; 4], b: [u64; 4]) -> bool {
    for i in (0..4).rev() {
        if a[i] < b[i] {
            return true;
        }
        if a[i] > b[i] {
            return false;
        }
    }
    true
}

fn isqrt_u256(c: [u64; 4]) -> u128 {
    let mut root = 0u128;
    for i in (0..128).rev() {
        let candidate = root | (1u128 << i);
        let cand_sq = mul_u128_to_u256(candidate, candidate);
        if u256_le(cand_sq, c) {
            root = candidate;
        }
    }
    root
}

impl Wad {
    pub const ZERO: Wad = Wad(0);
    pub const ONE: Wad = Wad(WAD);

    pub fn from_i128(val: i128) -> Result<Self, EngineError> {
        val.checked_mul(WAD)
            .map(Wad)
            .ok_or(EngineError::ArithmeticOverflow)
    }

    pub fn from_decimal_str(s: &str) -> Result<Self, EngineError> {
        let trimmed = s.trim();
        if trimmed.is_empty() {
            return Err(EngineError::InvalidFixedPoint(s.to_string()));
        }

        let (negative, num_str) = if let Some(stripped) = trimmed.strip_prefix('-') {
            (true, stripped)
        } else {
            (false, trimmed)
        };

        if num_str.is_empty() {
            return Err(EngineError::InvalidFixedPoint(s.to_string()));
        }

        let (int_str, frac_str_opt) = match num_str.split_once('.') {
            Some((int_part, frac_part)) => (int_part, Some(frac_part)),
            None => (num_str, None),
        };

        if int_str.is_empty() || !int_str.chars().all(|c| c.is_ascii_digit()) {
            return Err(EngineError::InvalidFixedPoint(s.to_string()));
        }

        let int_val: i128 = int_str
            .parse::<i128>()
            .map_err(|_| EngineError::InvalidFixedPoint(s.to_string()))?;

        let mut scaled_int = int_val
            .checked_mul(WAD)
            .ok_or(EngineError::ArithmeticOverflow)?;

        let frac_val: i128 = if let Some(frac_str) = frac_str_opt {
            if frac_str.is_empty() || !frac_str.chars().all(|c| c.is_ascii_digit()) {
                return Err(EngineError::InvalidFixedPoint(s.to_string()));
            }

            if frac_str.len() > 18 {
                let base_str = &frac_str[..18];
                let mut base = base_str
                    .parse::<u128>()
                    .map_err(|_| EngineError::InvalidFixedPoint(s.to_string()))?;
                let char19 = frac_str.as_bytes()[18];
                let has_tail = frac_str.as_bytes()[19..].iter().any(|&b| b != b'0');

                if char19 > b'5' || (char19 == b'5' && (has_tail || base % 2 != 0)) {
                    base += 1;
                }

                if base == WAD as u128 {
                    scaled_int = scaled_int
                        .checked_add(WAD)
                        .ok_or(EngineError::ArithmeticOverflow)?;
                    0
                } else {
                    base as i128
                }
            } else {
                let parsed = frac_str
                    .parse::<i128>()
                    .map_err(|_| EngineError::InvalidFixedPoint(s.to_string()))?;
                let factor = 10_i128.pow(18 - frac_str.len() as u32);
                parsed
                    .checked_mul(factor)
                    .ok_or(EngineError::ArithmeticOverflow)?
            }
        } else {
            0
        };

        let total = scaled_int
            .checked_add(frac_val)
            .ok_or(EngineError::ArithmeticOverflow)?;

        if negative {
            total
                .checked_neg()
                .map(Wad)
                .ok_or(EngineError::ArithmeticOverflow)
        } else {
            Ok(Wad(total))
        }
    }

    pub fn checked_add(self, other: Wad) -> Result<Wad, EngineError> {
        self.0
            .checked_add(other.0)
            .map(Wad)
            .ok_or(EngineError::ArithmeticOverflow)
    }

    pub fn checked_sub(self, other: Wad) -> Result<Wad, EngineError> {
        self.0
            .checked_sub(other.0)
            .map(Wad)
            .ok_or(EngineError::ArithmeticOverflow)
    }

    pub fn checked_mul(self, other: Wad) -> Result<Wad, EngineError> {
        let is_neg = (self.0 < 0) ^ (other.0 < 0);
        let a = self.0.unsigned_abs();
        let b = other.0.unsigned_abs();

        let prod = mul_u128_to_u256(a, b);
        let (mut q, rem) = div_u256_by_u64(prod, WAD as u64);

        let half = (WAD as u64) / 2;
        if rem > half || (rem == half && (q[0] & 1 == 1)) {
            let mut carry = 1u64;
            for limb in &mut q {
                let (sum, c) = limb.overflowing_add(carry);
                *limb = sum;
                carry = if c { 1 } else { 0 };
            }
        }

        if q[2] > 0 || q[3] > 0 {
            return Err(EngineError::ArithmeticOverflow);
        }

        let res_u128 = ((q[1] as u128) << 64) | (q[0] as u128);
        if res_u128 > i128::MAX as u128 {
            return Err(EngineError::ArithmeticOverflow);
        }

        let signed_res = res_u128 as i128;
        if is_neg {
            Ok(Wad(-signed_res))
        } else {
            Ok(Wad(signed_res))
        }
    }

    pub fn checked_div(self, other: Wad) -> Result<Wad, EngineError> {
        if other.0 == 0 {
            return Err(EngineError::DivisionByZero);
        }

        let is_neg = (self.0 < 0) ^ (other.0 < 0);
        let a = self.0.unsigned_abs();
        let b = other.0.unsigned_abs();

        let scaled = mul_u128_to_u256(a, WAD as u128);
        let (mut q, rem) = div_u256_by_u128(scaled, b)
            .ok_or(EngineError::ArithmeticOverflow)?;

        let round_up = match rem.checked_mul(2) {
            Some(d) => d > b || (d == b && (q & 1 == 1)),
            None => true,
        };

        if round_up {
            q = q.checked_add(1).ok_or(EngineError::ArithmeticOverflow)?;
        }

        if q > i128::MAX as u128 {
            return Err(EngineError::ArithmeticOverflow);
        }

        let signed_res = q as i128;
        if is_neg {
            Ok(Wad(-signed_res))
        } else {
            Ok(Wad(signed_res))
        }
    }

    pub fn isqrt(self) -> Result<Wad, EngineError> {
        if self.0 < 0 {
            return Err(EngineError::ArithmeticOverflow);
        }
        if self.0 == 0 {
            return Ok(Wad::ZERO);
        }

        let a = self.0 as u128;
        let scaled = mul_u128_to_u256(a, WAD as u128);
        let root = isqrt_u256(scaled);

        if root > i128::MAX as u128 {
            return Err(EngineError::ArithmeticOverflow);
        }

        Ok(Wad(root as i128))
    }
}

impl fmt::Display for Wad {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let negative = self.0 < 0;
        let abs_val = self.0.unsigned_abs();
        let int_part = abs_val / (WAD as u128);
        let frac_part = abs_val % (WAD as u128);

        if negative {
            write!(f, "-{}.{:018}", int_part, frac_part)
        } else {
            write!(f, "{}.{:018}", int_part, frac_part)
        }
    }
}
