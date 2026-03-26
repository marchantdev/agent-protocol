/// Dispute timeout: 7 days in seconds
pub const DISPUTE_TIMEOUT: i64 = 604_800;

/// Maximum number of active child delegations per job
pub const MAX_ACTIVE_CHILDREN: u8 = 8;

/// Minimum stake amount (0.1 SOL)
pub const MIN_STAKE_LAMPORTS: u64 = 100_000_000;

/// Slash rate for lost disputes (basis points — 5000 = 50%)
pub const SLASH_BPS: u64 = 5000;

/// Basis points denominator
pub const BPS_DENOMINATOR: u64 = 10000;

// Capability bitmask values
pub const CAP_CODE_REVIEW: u16 = 1 << 0;
pub const CAP_SECURITY_AUDIT: u16 = 1 << 1;
pub const CAP_DOCUMENTATION: u16 = 1 << 2;
pub const CAP_TESTING: u16 = 1 << 3;
pub const CAP_DEPLOYMENT: u16 = 1 << 4;
pub const CAP_GENERAL: u16 = 1 << 5;
