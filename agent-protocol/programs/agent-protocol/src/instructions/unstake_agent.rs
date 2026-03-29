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

    // Update logical balance
    ctx.accounts.stake_vault.amount = ctx.accounts.stake_vault.amount
        .checked_sub(amount)
        .ok_or(AgentProtocolError::Overflow)?;

    ctx.accounts.agent_profile.stake_amount = ctx.accounts.agent_profile.stake_amount
        .checked_sub(amount)
        .ok_or(AgentProtocolError::Overflow)?;

    let vault_info = ctx.accounts.stake_vault.to_account_info();
    let owner_info = ctx.accounts.owner.to_account_info();

    if ctx.accounts.stake_vault.amount == 0 {
        // Full withdrawal — return all lamports (including rent)
        let total_lamports = vault_info.lamports();
        **vault_info.try_borrow_mut_lamports()? = 0;
        **owner_info.try_borrow_mut_lamports()? += total_lamports;
    } else {
        // Partial withdrawal — ensure vault stays rent-exempt
        let min_rent = Rent::get()?.minimum_balance(vault_info.data_len());
        require!(
            vault_info.lamports().checked_sub(amount).unwrap_or(0) >= min_rent,
            AgentProtocolError::InsufficientStake
        );
        **vault_info.try_borrow_mut_lamports()? -= amount;
        **owner_info.try_borrow_mut_lamports()? += amount;
    }

    emit!(AgentUnstaked {
        agent: ctx.accounts.agent_profile.key(),
        amount,
        remaining_stake: ctx.accounts.stake_vault.amount,
    });

    Ok(())
}
