use anchor_lang::prelude::*;
use crate::state::{Job, JobStatus};
use crate::error::AgentProtocolError;
use crate::events::JobCompleted;

#[derive(Accounts)]
pub struct UpdateJob<'info> {
    pub agent: Signer<'info>,
    #[account(
        mut,
        constraint = job.agent == agent.key() @ AgentProtocolError::Unauthorized
    )]
    pub job: Account<'info, Job>,
}

pub fn handler(ctx: Context<UpdateJob>, result_uri: String) -> Result<()> {
    require!(!result_uri.is_empty(), AgentProtocolError::EmptyResultUri);

    let job = &mut ctx.accounts.job;

    require!(
        job.status == JobStatus::Pending || job.status == JobStatus::InProgress,
        AgentProtocolError::InvalidJobStatus
    );
    require!(job.active_children == 0, AgentProtocolError::UnresolvedChildren);

    if job.status == JobStatus::Pending {
        job.status = JobStatus::InProgress;
    }

    job.result_uri = result_uri.clone();
    job.status = JobStatus::Completed;
    job.completed_at = Some(Clock::get()?.unix_timestamp);

    emit!(JobCompleted {
        job: job.key(),
        agent: ctx.accounts.agent.key(),
        result_uri,
    });

    Ok(())
}
