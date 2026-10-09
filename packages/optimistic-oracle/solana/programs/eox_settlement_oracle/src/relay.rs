
use crate::state::ClaimBody;

pub const POSTED_VAA_MAGIC: &[u8; 3] = b"vaa";

pub const PAYLOAD_MAGIC: &[u8; 4] = b"EOXR";
pub const PAYLOAD_VERSION: u8 = 1;
pub const PAYLOAD_LEN: usize = 4 + 1 + 2 + 32 * 5;

#[derive(Debug, PartialEq, Eq)]
pub struct PostedVaa<'a> {
    pub sequence: u64,
    pub emitter_chain: u16,
    pub emitter_address: [u8; 32],
    pub payload: &'a [u8],
}

#[derive(Debug, PartialEq, Eq)]
pub struct RelayedResult {
    pub year: u16,
    pub body: ClaimBody,
    pub assertion_id: [u8; 32],
}

struct Reader<'a> {
    data: &'a [u8],
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        if self.data.len() < n {
            return None;
        }
        let (head, rest) = self.data.split_at(n);
        self.data = rest;
        Some(head)
    }

    fn array<const N: usize>(&mut self) -> Option<[u8; N]> {
        self.take(N)?.try_into().ok()
    }
}

pub fn parse_posted_vaa(data: &[u8]) -> Option<PostedVaa<'_>> {
    let mut r = Reader { data };
    if r.take(3)? != POSTED_VAA_MAGIC {
        return None;
    }
    r.take(1 + 1 + 4 + 32 + 4 + 4)?;
    let sequence = u64::from_le_bytes(r.array()?);
    let emitter_chain = u16::from_le_bytes(r.array()?);
    let emitter_address = r.array()?;
    let len = u32::from_le_bytes(r.array()?) as usize;
    let payload = r.take(len)?;
    Some(PostedVaa { sequence, emitter_chain, emitter_address, payload })
}

pub fn parse_result(payload: &[u8]) -> Option<RelayedResult> {
    if payload.len() != PAYLOAD_LEN {
        return None;
    }
    let mut r = Reader { data: payload };
    if r.take(4)? != PAYLOAD_MAGIC || r.take(1)?[0] != PAYLOAD_VERSION {
        return None;
    }
    let year = u16::from_be_bytes(r.array()?);
    let body = ClaimBody {
        evidence_root: r.array()?,
        methodology_image_id: r.array()?,
        output_hash: r.array()?,
        resolution_uri_hash: r.array()?,
    };
    let assertion_id = r.array()?;
    Some(RelayedResult { year, body, assertion_id })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub const GOLDEN_PAYLOAD: &str = concat!(
        "454f58520107e9",
        "0000000000000000000000000000000000000000000000000000000000001111",
        "0000000000000000000000000000000000000000000000000000000000002222",
        "0000000000000000000000000000000000000000000000000000000000003333",
        "3bd078a333c9589d2d52ae40c744d98d26f14af482521bab3fff59c26fa8d4ad",
        "b10e2d527612073b26eecdfd717e6a320cf44b4afac2b0732d9fcbe2b7fa0cf6",
    );

    fn unhex(s: &str) -> Vec<u8> {
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    fn word(tail: u16) -> [u8; 32] {
        let mut w = [0u8; 32];
        w[30..].copy_from_slice(&tail.to_be_bytes());
        w
    }

    pub fn posted_vaa(magic: &[u8; 3], sequence: u64, chain: u16, emitter: [u8; 32], payload: &[u8]) -> Vec<u8> {
        let mut d = magic.to_vec();
        d.push(1);
        d.push(1);
        d.extend_from_slice(&1_785_500_000u32.to_le_bytes());
        d.extend_from_slice(&[7u8; 32]);
        d.extend_from_slice(&1_785_500_100u32.to_le_bytes());
        d.extend_from_slice(&0u32.to_le_bytes());
        d.extend_from_slice(&sequence.to_le_bytes());
        d.extend_from_slice(&chain.to_le_bytes());
        d.extend_from_slice(&emitter);
        d.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        d.extend_from_slice(payload);
        d
    }

    #[test]
    fn reads_the_golden_payload_the_adapter_publishes() {
        let result = parse_result(&unhex(GOLDEN_PAYLOAD)).unwrap();
        assert_eq!(result.year, 2025);
        assert_eq!(result.body.evidence_root, word(0x1111));
        assert_eq!(result.body.methodology_image_id, word(0x2222));
        assert_eq!(result.body.output_hash, word(0x3333));
        assert_eq!(
            result.body.resolution_uri_hash,
            unhex("3bd078a333c9589d2d52ae40c744d98d26f14af482521bab3fff59c26fa8d4ad")[..]
        );
        assert_eq!(
            result.assertion_id,
            unhex("b10e2d527612073b26eecdfd717e6a320cf44b4afac2b0732d9fcbe2b7fa0cf6")[..]
        );
    }

    #[test]
    fn rejects_payloads_that_are_not_exactly_an_eox_result() {
        let golden = unhex(GOLDEN_PAYLOAD);

        let mut wrong_magic = golden.clone();
        wrong_magic[0] = b'X';
        let mut wrong_version = golden.clone();
        wrong_version[4] = 2;
        let mut trailing = golden.clone();
        trailing.push(0);

        for bad in [wrong_magic, wrong_version, trailing, golden[..golden.len() - 1].to_vec(), vec![]] {
            assert_eq!(parse_result(&bad), None);
        }
    }

    #[test]
    fn reads_a_posted_vaa() {
        let payload = unhex(GOLDEN_PAYLOAD);
        let emitter = word(0xabcd);
        let data = posted_vaa(POSTED_VAA_MAGIC, 42, 30, emitter, &payload);

        let vaa = parse_posted_vaa(&data).unwrap();
        assert_eq!(
            vaa,
            PostedVaa { sequence: 42, emitter_chain: 30, emitter_address: emitter, payload: &payload }
        );
    }

    #[test]
    fn rejects_outgoing_messages_and_truncated_accounts() {
        let payload = unhex(GOLDEN_PAYLOAD);
        for magic in [b"msg", b"msu"] {
            assert_eq!(parse_posted_vaa(&posted_vaa(magic, 1, 30, word(1), &payload)), None);
        }
        let full = posted_vaa(POSTED_VAA_MAGIC, 1, 30, word(1), &payload);
        assert_eq!(parse_posted_vaa(&full[..full.len() - 1]), None);
        assert_eq!(parse_posted_vaa(&full[..10]), None);
    }
}
