use anchor_lang::prelude::*;
use anchor_spl::token;
use crate::state::{AgentProfile, Job, JobStatus};
use crate::error::AgentProtocolError;
use crate::events::JobDelegated;
use crate::constants::MAX_ACTIVE_CHILDREN;

#[derive(Accounts)]
#[instruction(description: String, delegation_amount: u64, nonce: u64)]
pub struct DelegateTask<'info> {
    #[account(mut)]
    pub delegating_agent: Signer<'info>,
    #[account(
        mut,
        constraint = parent_job.agent == delegating_agent.key() @ AgentProtocolError::Unauthorized,
        constraint = (
            parent_job.status == JobStatus::Pending ||
            parent_job.status == JobStatus::InProgress
        ) @ AgentProtocolError::InvalidJobStatus
    )]
    pub parent_job: Account<'info, Job>,
    #[account(
        mut,
        constraint = sub_agent_profile.is_active @ AgentProtocolError::AgentNotActive
    )]
    pub sub_agent_profile: Account<'info, AgentProfile>,
    #[account(
        init,
        payer = delegating_agent,
        space = 8 + Job::INIT_SPACE,
        seeds = [
            b"job",
            delegating_agent.key().as_ref(),
            sub_agent_profile.key().as_ref(),
            &nonce.to_le_bytes()
        ],
        bump
    )]
    pub child_job: Account<'info, Job>,
    pub system_program: Program<'info, System>,
}

/// Delegate a subtask from parent job to a sub-agent.
///
/// For SPL token delegation, provide four remaining accounts:
/// `[parent_escrow_vault, child_escrow_vault, token_program, parent_agent_profile]`.
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, DelegateTask<'info>>,
    description: String,
    delegation_amount: u64,
    nonce: u64,
) -> Result<()> {
    require!(!description.is_empty(), AgentProtocolError::EmptyDescription);
    require!(description.len() <= 256, AgentProtocolError::DescriptionTooLong);

    // Validate and increment nonce on sub-agent profile
    require!(
        nonce == ctx.accounts.sub_agent_profile.job_nonce,
        AgentProtocolError::InvalidNonce
    );
    ctx.accounts.sub_agent_profile.job_nonce = ctx.accounts.sub_agent_profile.job_nonce
        .checked_add(1)
        .ok_or(AgentProtocolError::Overflow)?;

    require!(
        ctx.accounts.parent_job.active_children < MAX_ACTIVE_CHILDREN,
        AgentProtocolError::TooManyDelegations
    );

    let is_token_job = ctx.accounts.parent_job.token_mint.is_some();
    let parent_token_mint = ctx.accounts.parent_job.token_mint;

    // Deduct from parent escrow tracking
    ctx.accounts.parent_job.escrow_amount = ctx.accounts.parent_job.escrow_amount
        .checked_sub(delegation_amount)
        .ok_or(AgentProtocolError::InsufficientEscrow)?;

    if is_token_job {
        // Token delegation
        require!(
            ctx.remaining_accounts.len() >= 4,
            AgentProtocolError::MissingTokenAccounts
        );

        let parent_vault_info = &ctx.remaining_accounts[0];
        let child_vault_info = &ctx.remaining_accounts[1];
        let token_prog_info = &ctx.remaining_accounts[2];
        let parent_agent_profile_info = &ctx.remaining_accounts[3];

        require!(
            *token_prog_info.key == anchor_spl::token::ID,
            AgentProtocolError::InvalidTokenAccounts
        );

        let parent_nonce_bytes = ctx.accounts.parent_job.nonce_seed.to_le_bytes();
        let parent_bump = ctx.accounts.parent_job.bump;
        let parent_client = ctx.accounts.parent_job.client;

        let seeds: &[&[u8]] = &[
            b"job",
            parent_client.as_ref(),
            parent_agent_profile_info.key.as_ref(),
            &parent_nonce_bytes,
            &[parent_bump],
        ];
        let signer = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                token_prog_info.to_account_info(),
                token::Transfer {
                    from: parent_vault_info.to_account_info(),
                    to: child_vault_info.to_account_info(),
                    authority: ctx.accounts.parent_job.to_account_info(),
                },
                signer,
            ),
            delegation_amount,
        )?;
    } else {
        // SOL delegation — verify parent stays rent-exempt
        let min_rent = Rent::get()?.minimum_balance(8 + Job::INIT_SPACE);
        let parent_info = ctx.accounts.parent_job.to_account_info();
        require!(
            parent_info.lamports() - delegation_amount >= min_rent,
            AgentProtocolError::InsufficientEscrow
        );

        **parent_info.try_borrow_mut_lamports()? -= delegation_amount;
        let child_info = ctx.accounts.child_job.to_account_info();
        **child_info.try_borrow_mut_lamports()? += delegation_amount;
    }

    ctx.accounts.parent_job.active_children = ctx.accounts.parent_job.active_children
        .checked_add(1)
        .ok_or(AgentProtocolError::Overflow)?;

    if ctx.accounts.parent_job.status == JobStatus::Pending {
        ctx.accounts.parent_job.status = JobStatus::InProgress;
    }

    let clock = Clock::get()?;
    let child_escrow_vault = if is_token_job {
        Some(ctx.remaining_accounts[1].key())
    } else {
        None
    };

    let child = &mut ctx.accounts.child_job;
    child.client = ctx.accounts.delegating_agent.key();
    child.agent = ctx.accounts.sub_agent_profile.owner;
    child.escrow_amount = delegation_amount;
    child.status = JobStatus::Pending;
    child.description = description;
    child.result_uri = String::new();
    child.parent_job = Some(ctx.accounts.parent_job.key());
    child.active_children = 0;
    child.auto_release_at = None;
    child.disputed_at = None;
    child.created_at = clock.unix_timestamp;
    child.completed_at = None;
    child.nonce_seed = nonce;
    child.bump = ctx.bumps.child_job;
    child.token_mint = parent_token_mint;
    child.escrow_vault = child_escrow_vault;
    child.arbiter = None;

    emit!(JobDelegated {
        parent_job: ctx.accounts.parent_job.key(),
        child_job: child.key(),
        delegating_agent: ctx.accounts.delegating_agent.key(),
        sub_agent: ctx.accounts.sub_agent_profile.owner,
        amount: delegation_amount,
    });

    Ok(())
}
