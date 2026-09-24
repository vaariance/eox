use crate::error::OracleError;
use std::fmt;
use std::ops::{Add, Div, Mul, Sub};

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

fn div_u256_by_u128(c: [u64; 4], b: u128) -> Option<u128> {
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

    Some(q)
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

    pub fn from_i128(val: i128) -> Result<Self, OracleError> {
        val.checked_mul(WAD)
            .map(Wad)
            .ok_or(OracleError::ArithmeticOverflow)
    }

    pub fn from_decimal_str(s: &str) -> Result<Self, OracleError> {
        let trimmed = s.trim();
        if trimmed.is_empty() {
            return Err(OracleError::InvalidFixedPoint(s.to_string()));
        }

        let (negative, num_str) = if let Some(stripped) = trimmed.strip_prefix('-') {
            (true, stripped)
        } else if let Some(stripped) = trimmed.strip_prefix('+') {
            (false, stripped)
        } else {
            (false, trimmed)
        };

        let parts: Vec<&str> = num_str.split('.').collect();
        if parts.len() > 2 {
            return Err(OracleError::InvalidFixedPoint(s.to_string()));
        }

        let int_part: i128 = if parts[0].is_empty() {
            0
        } else {
            parts[0]
                .parse::<i128>()
                .map_err(|_| OracleError::InvalidFixedPoint(s.to_string()))?
        };

        let scaled_int = int_part
            .checked_mul(WAD)
            .ok_or(OracleError::ArithmeticOverflow)?;

        let frac_val: i128 = if parts.len() == 2 {
            let frac_str = parts[1];
            if frac_str.len() > 18 {
                let truncated = &frac_str[..18];
                truncated
                    .parse::<i128>()
                    .map_err(|_| OracleError::InvalidFixedPoint(s.to_string()))?
            } else {
                let parsed = frac_str
                    .parse::<i128>()
                    .map_err(|_| OracleError::InvalidFixedPoint(s.to_string()))?;
                let factor = 10_i128.pow(18 - frac_str.len() as u32);
                parsed
                    .checked_mul(factor)
                    .ok_or(OracleError::ArithmeticOverflow)?
            }
        } else {
            0
        };

        let total = scaled_int
            .checked_add(frac_val)
            .ok_or(OracleError::ArithmeticOverflow)?;

        if negative {
            total
                .checked_neg()
                .map(Wad)
                .ok_or(OracleError::ArithmeticOverflow)
        } else {
            Ok(Wad(total))
        }
    }

    pub fn checked_add(self, other: Wad) -> Result<Wad, OracleError> {
        self.0
            .checked_add(other.0)
            .map(Wad)
            .ok_or(OracleError::ArithmeticOverflow)
    }

    pub fn checked_sub(self, other: Wad) -> Result<Wad, OracleError> {
        self.0
            .checked_sub(other.0)
            .map(Wad)
            .ok_or(OracleError::ArithmeticOverflow)
    }

    pub fn checked_mul(self, other: Wad) -> Result<Wad, OracleError> {
        let is_neg = (self.0 < 0) ^ (other.0 < 0);
        let a = self.0.unsigned_abs();
        let b = other.0.unsigned_abs();

        let prod = mul_u128_to_u256(a, b);
        let (q, _) = div_u256_by_u64(prod, WAD as u64);

        if q[2] > 0 || q[3] > 0 {
            return Err(OracleError::ArithmeticOverflow);
        }

        let res_u128 = ((q[1] as u128) << 64) | (q[0] as u128);
        if res_u128 > i128::MAX as u128 {
            return Err(OracleError::ArithmeticOverflow);
        }

        let signed_res = res_u128 as i128;
        if is_neg {
            Ok(Wad(-signed_res))
        } else {
            Ok(Wad(signed_res))
        }
    }

    pub fn checked_div(self, other: Wad) -> Result<Wad, OracleError> {
        if other.0 == 0 {
            return Err(OracleError::DivisionByZero);
        }

        let is_neg = (self.0 < 0) ^ (other.0 < 0);
        let a = self.0.unsigned_abs();
        let b = other.0.unsigned_abs();

        let scaled = mul_u128_to_u256(a, WAD as u128);
        let res_u128 = div_u256_by_u128(scaled, b)
            .ok_or(OracleError::ArithmeticOverflow)?;

        if res_u128 > i128::MAX as u128 {
            return Err(OracleError::ArithmeticOverflow);
        }

        let signed_res = res_u128 as i128;
        if is_neg {
            Ok(Wad(-signed_res))
        } else {
            Ok(Wad(signed_res))
        }
    }

    pub fn isqrt(self) -> Result<Wad, OracleError> {
        if self.0 < 0 {
            return Err(OracleError::ArithmeticOverflow);
        }
        if self.0 == 0 {
            return Ok(Wad::ZERO);
        }

        let a = self.0 as u128;
        let scaled = mul_u128_to_u256(a, WAD as u128);
        let root = isqrt_u256(scaled);

        if root > i128::MAX as u128 {
            return Err(OracleError::ArithmeticOverflow);
        }

        Ok(Wad(root as i128))
    }
}

impl fmt::Display for Wad {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let negative = self.0 < 0;
        let abs_val = self.0.abs();
        let int_part = abs_val / WAD;
        let frac_part = abs_val % WAD;

        if negative {
            write!(f, "-{}.{:018}", int_part, frac_part)
        } else {
            write!(f, "{}.{:018}", int_part, frac_part)
        }
    }
}

impl Add for Wad {
    type Output = Self;
    fn add(self, rhs: Self) -> Self::Output {
        self.checked_add(rhs).expect("Wad add overflow")
    }
}

impl Sub for Wad {
    type Output = Self;
    fn sub(self, rhs: Self) -> Self::Output {
        self.checked_sub(rhs).expect("Wad sub overflow")
    }
}

impl Mul for Wad {
    type Output = Self;
    fn mul(self, rhs: Self) -> Self::Output {
        self.checked_mul(rhs).expect("Wad mul overflow")
    }
}

impl Div for Wad {
    type Output = Self;
    fn div(self, rhs: Self) -> Self::Output {
        self.checked_div(rhs).expect("Wad div error")
    }
}
