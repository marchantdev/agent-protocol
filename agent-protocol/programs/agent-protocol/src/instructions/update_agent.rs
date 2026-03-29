use anchor_lang::prelude::*;
use crate::state::AgentProfile;
use crate::error::AgentProtocolError;
use crate::events::AgentUpdated;

#[derive(Accounts)]
pub struct UpdateAgent<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        constraint = agent_profile.owner == owner.key() @ AgentProtocolError::Unauthorized,
        seeds = [b"agent", owner.key().as_ref()],
        bump = agent_profile.bump
    )]
    pub agent_profile: Account<'info, AgentProfile>,
}

pub fn handler(
    ctx: Context<UpdateAgent>,
    name: Option<String>,
    description: Option<String>,
    capabilities: Option<u16>,
    price_lamports: Option<u64>,
    is_active: Option<bool>,
) -> Result<()> {
    let profile = &mut ctx.accounts.agent_profile;

    if let Some(ref name) = name {
        require!(name.len() <= 32, AgentProtocolError::NameTooLong);
        require!(!name.is_empty(), AgentProtocolError::EmptyName);
        profile.name = name.clone();
    }

    if let Some(desc) = description {
        require!(desc.len() <= 128, AgentProtocolError::DescriptionTooLong);
        profile.description = desc;
    }

    if let Some(caps) = capabilities {
        profile.capabilities = caps;
    }

    if let Some(price) = price_lamports {
        require!(price > 0, AgentProtocolError::InvalidPrice);
        profile.price_lamports = price;
    }

    if let Some(active) = is_active {
        profile.is_active = active;
    }

    emit!(AgentUpdated {
        agent: profile.key(),
        owner: ctx.accounts.owner.key(),
        name: profile.name.clone(),
    });

    Ok(())
}
