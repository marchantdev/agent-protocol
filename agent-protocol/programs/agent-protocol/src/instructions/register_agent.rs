use anchor_lang::prelude::*;
use crate::state::AgentProfile;
use crate::error::AgentProtocolError;
use crate::events::AgentRegistered;

#[derive(Accounts)]
pub struct RegisterAgent<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + AgentProfile::INIT_SPACE,
        seeds = [b"agent", owner.key().as_ref()],
        bump
    )]
    pub agent_profile: Account<'info, AgentProfile>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<RegisterAgent>,
    name: String,
    description: String,
    capabilities: u16,
    price_lamports: u64,
) -> Result<()> {
    require!(name.len() <= 32, AgentProtocolError::NameTooLong);
    require!(description.len() <= 128, AgentProtocolError::DescriptionTooLong);
    require!(price_lamports > 0, AgentProtocolError::InvalidPrice);
    require!(!name.is_empty(), AgentProtocolError::EmptyName);

    let profile = &mut ctx.accounts.agent_profile;
    profile.owner = ctx.accounts.owner.key();
    profile.name = name.clone();
    profile.description = description;
    profile.capabilities = capabilities;
    profile.price_lamports = price_lamports;
    profile.is_active = true;
    profile.rating_sum = 0;
    profile.rating_count = 0;
    profile.jobs_completed = 0;
    profile.created_at = Clock::get()?.unix_timestamp;
    profile.bump = ctx.bumps.agent_profile;
    profile.job_nonce = 0;
    profile.stake_amount = 0;

    emit!(AgentRegistered {
        agent: profile.key(),
        owner: ctx.accounts.owner.key(),
        name,
        price_lamports,
    });

    Ok(())
}
