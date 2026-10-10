use borsh::{BorshDeserialize, BorshSerialize};
use sha2::{compress256, digest::generic_array::GenericArray};
use crate::{Hash, MathError, Result};

#[derive(Clone, Debug, BorshSerialize, BorshDeserialize)]
pub struct StreamingHash {
    state: [u32; 8],
    buffer: [u8; 64],
    buffered: u8,
    length: u64,
}

impl StreamingHash {
    pub fn new(domain: &str) -> Result<Self> {
        let mut result = Self {
            state: [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19],
            buffer: [0; 64], buffered: 0, length: 0,
        };
        let length = u32::try_from(domain.len()).map_err(|_| MathError::Encoding)?;
        result.update(b"EOX/ORACLE/V1\0")?;
        result.update(&length.to_le_bytes())?;
        result.update(domain.as_bytes())?;
        Ok(result)
    }

    fn valid(&self) -> Result<()> {
        if self.buffered >= 64 || self.length % 64 != self.buffered as u64
            || self.length > u64::MAX / 8 {
            return Err(MathError::Encoding);
        }
        Ok(())
    }

    pub fn update(&mut self, mut bytes: &[u8]) -> Result<()> {
        self.valid()?;
        let next = self.length.checked_add(bytes.len() as u64)
            .filter(|n| *n <= u64::MAX / 8).ok_or(MathError::Encoding)?;
        while !bytes.is_empty() {
            let start = self.buffered as usize;
            let size = (64 - start).min(bytes.len());
            self.buffer[start..start + size].copy_from_slice(&bytes[..size]);
            self.buffered += size as u8;
            bytes = &bytes[size..];
            if self.buffered == 64 {
                compress256(&mut self.state, &[GenericArray::clone_from_slice(&self.buffer)]);
                self.buffer = [0; 64];
                self.buffered = 0;
            }
        }
        self.length = next;
        Ok(())
    }

    pub fn finish(&self) -> Result<Hash> {
        self.valid()?;
        let mut state = self.state;
        let mut block = self.buffer;
        let end = self.buffered as usize;
        block[end..].fill(0);
        block[end] = 0x80;
        if end >= 56 {
            compress256(&mut state, &[GenericArray::clone_from_slice(&block)]);
            block = [0; 64];
        }
        block[56..].copy_from_slice(&(self.length * 8).to_be_bytes());
        compress256(&mut state, &[GenericArray::clone_from_slice(&block)]);
        let mut result = [0; 32];
        for (target, word) in result.chunks_exact_mut(4).zip(state) {
            target.copy_from_slice(&word.to_be_bytes());
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    #[test]
    fn every_padding_boundary_and_restart_matches_sha256() {
        for len in 0..260 {
            let bytes: Vec<u8> = (0..len).map(|n| n as u8).collect();
            let domain = "continuous-snapshot-claim-v1";
            let mut reference = Sha256::new();
            reference.update(b"EOX/ORACLE/V1\0");
            reference.update((domain.len() as u32).to_le_bytes());
            reference.update(domain.as_bytes());
            reference.update(&bytes);
            let expected: Hash = reference.finalize().into();
            for chunk in [1, 7, 55, 56, 63, 64, 65, 128, 512] {
                let mut stream = StreamingHash::new(domain).unwrap();
                for part in bytes.chunks(chunk) {
                    stream.update(part).unwrap();
                    stream = StreamingHash::try_from_slice(&stream.try_to_vec().unwrap()).unwrap();
                }
                assert_eq!(stream.finish().unwrap(), expected);
                assert_eq!(stream.finish().unwrap(), expected);
                assert_eq!(stream.try_to_vec().unwrap().len(), 105);
            }
        }
    }

    #[test]
    fn malformed_saved_state_is_rejected_without_mutation() {
        let mut stream = StreamingHash::new("x").unwrap();
        stream.buffered = 64;
        let before = stream.try_to_vec().unwrap();
        assert!(stream.update(b"x").is_err());
        assert!(stream.finish().is_err());
        assert_eq!(stream.try_to_vec().unwrap(), before);
    }
}
