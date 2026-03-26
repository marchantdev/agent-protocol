use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct StakeVault {
    pub agent_profile: Pubkey,
    pub amount: u64,
    pub bump: u8,
}
