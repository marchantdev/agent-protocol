use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::{AgentProfile, StakeVault};
use crate::error::AgentProtocolError;
use crate::events::AgentStaked;
use crate::constants::MIN_STAKE_LAMPORTS;

#[derive(Accounts)]
pub struct StakeAgent<'info> {
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
        init_if_needed,
        payer = owner,
        space = 8 + StakeVault::INIT_SPACE,
        seeds = [b"stake", agent_profile.key().as_ref()],
        bump
    )]
    pub stake_vault: Account<'info, StakeVault>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<StakeAgent>, amount: u64) -> Result<()> {
    require!(amount >= MIN_STAKE_LAMPORTS, AgentProtocolError::InsufficientStake);

    // Transfer SOL from owner to stake vault PDA
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.owner.to_account_info(),
                to: ctx.accounts.stake_vault.to_account_info(),
            },
        ),
        amount,
    )?;

    let vault = &mut ctx.accounts.stake_vault;
    // Initialize on first stake
    if vault.agent_profile == Pubkey::default() {
        vault.agent_profile = ctx.accounts.agent_profile.key();
        vault.bump = ctx.bumps.stake_vault;
    }
    vault.amount = vault.amount
        .checked_add(amount)
        .ok_or(AgentProtocolError::Overflow)?;

    let profile = &mut ctx.accounts.agent_profile;
    profile.stake_amount = profile.stake_amount
        .checked_add(amount)
        .ok_or(AgentProtocolError::Overflow)?;

    emit!(AgentStaked {
        agent: ctx.accounts.agent_profile.key(),
        amount,
        total_stake: vault.amount,
    });

    Ok(())
}
