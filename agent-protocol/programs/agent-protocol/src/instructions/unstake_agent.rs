use anchor_lang::prelude::*;
use crate::state::{AgentProfile, StakeVault};
use crate::error::AgentProtocolError;
use crate::events::AgentUnstaked;

#[derive(Accounts)]
pub struct UnstakeAgent<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        constraint = agent_profile.owner == owner.key() @ AgentProtocolError::Unauthorized,
        seeds = [b"agent", owner.key().as_ref()],
        bump = agent_profile.bump
    )]
    pub agent_profile: Account<'info, AgentProfile>,
    #[account(
        mut,
        constraint = stake_vault.agent_profile == agent_profile.key() @ AgentProtocolError::Unauthorized,
        seeds = [b"stake", agent_profile.key().as_ref()],
        bump = stake_vault.bump
    )]
    pub stake_vault: Account<'info, StakeVault>,
}

pub fn handler(ctx: Context<UnstakeAgent>, amount: u64) -> Result<()> {
    require!(
        ctx.accounts.stake_vault.amount >= amount,
        AgentProtocolError::InsufficientStake
    );

    // Update vault balance
    ctx.accounts.stake_vault.amount = ctx.accounts.stake_vault.amount
        .checked_sub(amount)
        .ok_or(AgentProtocolError::Overflow)?;

    // Transfer SOL from stake vault to owner via direct lamport manipulation
    let vault_info = ctx.accounts.stake_vault.to_account_info();
    let owner_info = ctx.accounts.owner.to_account_info();
    **vault_info.try_borrow_mut_lamports()? -= amount;
    **owner_info.try_borrow_mut_lamports()? += amount;

    // Update profile mirror
    ctx.accounts.agent_profile.stake_amount = ctx.accounts.agent_profile.stake_amount
        .checked_sub(amount)
        .ok_or(AgentProtocolError::Overflow)?;

    emit!(AgentUnstaked {
        agent: ctx.accounts.agent_profile.key(),
        amount,
        remaining_stake: ctx.accounts.stake_vault.amount,
    });

    Ok(())
}
