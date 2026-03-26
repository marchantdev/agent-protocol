use anchor_lang::prelude::*;
use crate::state::{AgentProfile, Job, JobStatus, Rating};
use crate::error::AgentProtocolError;
use crate::events::AgentRated;

#[derive(Accounts)]
pub struct RateAgent<'info> {
    #[account(mut)]
    pub client: Signer<'info>,
    #[account(
        constraint = job.status == JobStatus::Finalized @ AgentProtocolError::InvalidJobStatus,
        constraint = job.client == client.key() @ AgentProtocolError::Unauthorized
    )]
    pub job: Account<'info, Job>,
    #[account(mut)]
    pub agent_profile: Account<'info, AgentProfile>,
    #[account(
        init,
        payer = client,
        space = 8 + Rating::INIT_SPACE,
        seeds = [b"rating", job.key().as_ref()],
        bump
    )]
    pub rating: Account<'info, Rating>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RateAgent>, score: u8) -> Result<()> {
    require!(score >= 1 && score <= 5, AgentProtocolError::InvalidRating);

    let rating = &mut ctx.accounts.rating;
    rating.agent = ctx.accounts.agent_profile.key();
    rating.rater = ctx.accounts.client.key();
    rating.job = ctx.accounts.job.key();
    rating.score = score;
    rating.created_at = Clock::get()?.unix_timestamp;
    rating.bump = ctx.bumps.rating;

    let profile = &mut ctx.accounts.agent_profile;
    profile.rating_sum = profile.rating_sum
        .checked_add(score as u64)
        .ok_or(AgentProtocolError::Overflow)?;
    profile.rating_count = profile.rating_count
        .checked_add(1)
        .ok_or(AgentProtocolError::Overflow)?;

    let new_avg_x100 = profile.rating_sum
        .checked_mul(100)
        .ok_or(AgentProtocolError::Overflow)?
        .checked_div(profile.rating_count as u64)
        .ok_or(AgentProtocolError::Overflow)?;

    emit!(AgentRated {
        agent: profile.key(),
        rater: ctx.accounts.client.key(),
        score,
        new_avg_x100,
    });

    Ok(())
}
