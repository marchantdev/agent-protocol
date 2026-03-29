use anchor_lang::prelude::*;
use crate::state::{Job, JobStatus};
use crate::error::AgentProtocolError;

#[derive(Accounts)]
pub struct CloseJob<'info> {
    /// CHECK: Client receives rent. Validated against job.client.
    #[account(
        mut,
        constraint = job.client == client.key() @ AgentProtocolError::Unauthorized
    )]
    pub client: AccountInfo<'info>,
    #[account(
        mut,
        close = client,
        constraint = (
            job.status == JobStatus::Finalized ||
            job.status == JobStatus::Cancelled
        ) @ AgentProtocolError::InvalidJobStatus
    )]
    pub job: Account<'info, Job>,
}

/// Close a finalized or cancelled job account, returning rent to client.
/// Permissionless — anyone can call this to reclaim rent on terminal jobs.
pub fn handler(_ctx: Context<CloseJob>) -> Result<()> {
    Ok(())
}
