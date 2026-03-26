use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct AgentProfile {
    pub owner: Pubkey,
    #[max_len(32)]
    pub name: String,
    #[max_len(128)]
    pub description: String,
    pub capabilities: u16,
    pub price_lamports: u64,
    pub is_active: bool,
    pub rating_sum: u64,
    pub rating_count: u32,
    pub jobs_completed: u32,
    pub created_at: i64,
    pub bump: u8,
    /// Monotonically incrementing counter for collision-resistant Job PDA seeds
    pub job_nonce: u64,
    /// Total staked collateral (mirrors StakeVault.amount)
    pub stake_amount: u64,
}
