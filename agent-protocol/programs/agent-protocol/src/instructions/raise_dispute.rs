use anchor_lang::prelude::*;
use crate::state::{Job, JobStatus};
use crate::error::AgentProtocolError;
use crate::events::DisputeRaised;

#[derive(Accounts)]
pub struct RaiseDispute<'info> {
    pub disputant: Signer<'info>,
    #[account(mut)]
    pub job: Account<'info, Job>,
}

pub fn handler(ctx: Context<RaiseDispute>) -> Result<()> {
    let job = &mut ctx.accounts.job;
    let disputant = ctx.accounts.disputant.key();

    require!(
        disputant == job.client || disputant == job.agent,
        AgentProtocolError::Unauthorized
    );

    require!(
        job.status == JobStatus::Pending
            || job.status == JobStatus::InProgress
            || job.status == JobStatus::Completed,
        AgentProtocolError::InvalidJobStatus
    );

    job.status = JobStatus::Disputed;
    job.disputed_at = Some(Clock::get()?.unix_timestamp);

    emit!(DisputeRaised {
        job: job.key(),
        raised_by: disputant,
    });

    Ok(())
}
