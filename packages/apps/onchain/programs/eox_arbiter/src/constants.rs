use anchor_lang::prelude::*;

#[constant]
pub const PANEL_SEED: &[u8] = b"panel";

#[constant]
pub const AUTHORITY_SEED: &[u8] = b"arbiter";

#[constant]
pub const VAULT_SEED: &[u8] = b"panel_vault";

#[constant]
pub const CASE_SEED: &[u8] = b"case";

pub const PANEL_SIZE: usize = 3;
pub const MAJORITY: usize = 2;
