use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Job {
    pub client: Pubkey,
    pub agent: Pubkey,
    pub escrow_amount: u64,
    pub status: JobStatus,
    #[max_len(256)]
    pub description: String,
    #[max_len(128)]
    pub result_uri: String,
    pub parent_job: Option<Pubkey>,
    pub active_children: u8,
    pub auto_release_at: Option<i64>,
    pub disputed_at: Option<i64>,
    pub created_at: i64,
    pub completed_at: Option<i64>,
    pub nonce_seed: u64,
    pub bump: u8,
    /// SPL token mint (None = SOL-denominated job)
    pub token_mint: Option<Pubkey>,
    /// Token escrow vault address (None for SOL jobs)
    pub escrow_vault: Option<Pubkey>,
    /// Designated dispute arbiter (None = timeout-only resolution)
    pub arbiter: Option<Pubkey>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum JobStatus {
    Pending,
    InProgress,
    Completed,
    Disputed,
    Cancelled,
    Finalized,
}
