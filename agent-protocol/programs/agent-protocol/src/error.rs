use anchor_lang::prelude::*;

#[error_code]
pub enum AgentProtocolError {
    #[msg("Agent name too long (max 32 chars)")]
    NameTooLong,
    #[msg("Description too long (max 256 chars)")]
    DescriptionTooLong,
    #[msg("Price must be greater than zero")]
    InvalidPrice,
    #[msg("Agent is not active")]
    AgentNotActive,
    #[msg("Insufficient payment")]
    InsufficientPayment,
    #[msg("Invalid job status for this operation")]
    InvalidJobStatus,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Rating must be between 1 and 5")]
    InvalidRating,
    #[msg("Insufficient escrow balance for delegation")]
    InsufficientEscrow,
    #[msg("Result URI is required")]
    EmptyResultUri,
    #[msg("Description is required")]
    EmptyDescription,
    #[msg("Auto-release time has not been reached")]
    AutoReleaseNotReady,
    #[msg("No auto-release configured for this job")]
    NoAutoRelease,
    #[msg("Dispute timeout has not been reached")]
    DisputeTimeoutNotReached,
    #[msg("Agent has unresolved child delegations")]
    UnresolvedChildren,
    #[msg("Parent job mismatch")]
    ParentJobMismatch,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Too many active delegations (max 8)")]
    TooManyDelegations,
    #[msg("Invalid nonce — must match agent profile's current job_nonce")]
    InvalidNonce,
    #[msg("Invalid token mint or token accounts")]
    InvalidTokenAccounts,
    #[msg("Insufficient stake amount")]
    InsufficientStake,
    #[msg("Invalid arbiter")]
    InvalidArbiter,
    #[msg("Missing required token accounts in remaining_accounts")]
    MissingTokenAccounts,
    #[msg("Escrow vault mismatch")]
    EscrowVaultMismatch,
}
