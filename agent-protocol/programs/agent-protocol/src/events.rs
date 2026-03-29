use anchor_lang::prelude::*;

#[event]
pub struct AgentRegistered {
    pub agent: Pubkey,
    pub owner: Pubkey,
    pub name: String,
    pub price_lamports: u64,
}

#[event]
pub struct AgentUpdated {
    pub agent: Pubkey,
    pub owner: Pubkey,
    pub name: String,
}

#[event]
pub struct JobCreated {
    pub job: Pubkey,
    pub client: Pubkey,
    pub agent: Pubkey,
    pub escrow_amount: u64,
    pub token_mint: Option<Pubkey>,
    pub auto_release_at: Option<i64>,
}

#[event]
pub struct JobCompleted {
    pub job: Pubkey,
    pub agent: Pubkey,
    pub result_uri: String,
}

#[event]
pub struct JobCancelled {
    pub job: Pubkey,
    pub client: Pubkey,
    pub refund_amount: u64,
}

#[event]
pub struct JobDelegated {
    pub parent_job: Pubkey,
    pub child_job: Pubkey,
    pub delegating_agent: Pubkey,
    pub sub_agent: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PaymentReleased {
    pub job: Pubkey,
    pub agent: Pubkey,
    pub amount: u64,
    pub auto_released: bool,
    pub token_mint: Option<Pubkey>,
}

#[event]
pub struct DisputeRaised {
    pub job: Pubkey,
    pub raised_by: Pubkey,
}

#[event]
pub struct DisputeResolved {
    pub job: Pubkey,
    pub refund_amount: u64,
    pub resolved_by: Pubkey,
}

#[event]
pub struct AgentRated {
    pub agent: Pubkey,
    pub rater: Pubkey,
    pub score: u8,
    pub new_avg_x100: u64,
}

#[event]
pub struct AgentStaked {
    pub agent: Pubkey,
    pub amount: u64,
    pub total_stake: u64,
}

#[event]
pub struct AgentUnstaked {
    pub agent: Pubkey,
    pub amount: u64,
    pub remaining_stake: u64,
}

#[event]
pub struct StakeSlashed {
    pub agent: Pubkey,
    pub job: Pubkey,
    pub slash_amount: u64,
    pub remaining_stake: u64,
}

#[event]
pub struct ArbiterPaid {
    pub arbiter: Pubkey,
    pub job: Pubkey,
    pub fee_amount: u64,
}

#[event]
pub struct JobRejected {
    pub job: Pubkey,
    pub agent: Pubkey,
    pub refund_amount: u64,
}
