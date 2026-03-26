use anchor_lang::prelude::*;
use anchor_spl::token;
use crate::state::{AgentProfile, Job, JobStatus};
use crate::error::AgentProtocolError;
use crate::events::PaymentReleased;

#[derive(Accounts)]
pub struct ReleasePayment<'info> {
    #[account(
        mut,
        constraint = job.client == client.key() @ AgentProtocolError::Unauthorized
    )]
    pub client: Signer<'info>,
    /// CHECK: Agent wallet receives SOL payment. Validated against job.agent.
    #[account(
        mut,
        constraint = job.agent == agent.key() @ AgentProtocolError::Unauthorized
    )]
    pub agent: AccountInfo<'info>,
    #[account(
        mut,
        constraint = agent_profile.owner == job.agent @ AgentProtocolError::Unauthorized
    )]
    pub agent_profile: Account<'info, AgentProfile>,
    #[account(mut)]
    pub job: Account<'info, Job>,
    /// Optional parent job — required when job.parent_job is Some
    #[account(mut)]
    pub parent_job: Option<Account<'info, Job>>,
}

/// Release escrowed payment to the agent.
///
/// For SPL token jobs, provide three remaining accounts:
/// `[escrow_vault, agent_token_account, token_program]`.
pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, ReleasePayment<'info>>) -> Result<()> {
    require!(
        ctx.accounts.job.status == JobStatus::Completed,
        AgentProtocolError::InvalidJobStatus
    );

    // Read all values before mutation
    let escrow_amount = ctx.accounts.job.escrow_amount;
    let is_token_job = ctx.accounts.job.token_mint.is_some();
    let nonce_bytes = ctx.accounts.job.nonce_seed.to_le_bytes();
    let bump = ctx.accounts.job.bump;
    let client_key = ctx.accounts.job.client;
    let agent_profile_key = ctx.accounts.agent_profile.key();
    let escrow_vault_key = ctx.accounts.job.escrow_vault;
    let token_mint_key = ctx.accounts.job.token_mint;
    let has_parent = ctx.accounts.job.parent_job.is_some();
    let parent_key = ctx.accounts.job.parent_job;

    // Set terminal state
    ctx.accounts.job.status = JobStatus::Finalized;
    ctx.accounts.job.escrow_amount = 0;

    if is_token_job {
        require!(
            ctx.remaining_accounts.len() >= 3,
            AgentProtocolError::MissingTokenAccounts
        );

        let escrow_vault_info = &ctx.remaining_accounts[0];
        let agent_token_info = &ctx.remaining_accounts[1];
        let token_prog_info = &ctx.remaining_accounts[2];

        require!(
            *token_prog_info.key == anchor_spl::token::ID,
            AgentProtocolError::InvalidTokenAccounts
        );
        require!(
            escrow_vault_key == Some(escrow_vault_info.key()),
            AgentProtocolError::EscrowVaultMismatch
        );

        let seeds: &[&[u8]] = &[
            b"job",
            client_key.as_ref(),
            agent_profile_key.as_ref(),
            &nonce_bytes,
            &[bump],
        ];
        let signer = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                token_prog_info.to_account_info(),
                token::Transfer {
                    from: escrow_vault_info.to_account_info(),
                    to: agent_token_info.to_account_info(),
                    authority: ctx.accounts.job.to_account_info(),
                },
                signer,
            ),
            escrow_amount,
        )?;
    } else {
        // SOL transfer via direct lamport manipulation
        let job_info = ctx.accounts.job.to_account_info();
        let agent_info = ctx.accounts.agent.to_account_info();
        **job_info.try_borrow_mut_lamports()? -= escrow_amount;
        **agent_info.try_borrow_mut_lamports()? += escrow_amount;
    }

    // Update agent stats
    let profile = &mut ctx.accounts.agent_profile;
    profile.jobs_completed = profile.jobs_completed
        .checked_add(1)
        .ok_or(AgentProtocolError::Overflow)?;

    // Handle parent decrement for child jobs
    if has_parent {
        let parent = ctx.accounts.parent_job.as_mut()
            .ok_or(AgentProtocolError::ParentJobMismatch)?;
        require!(
            parent_key.unwrap() == parent.key(),
            AgentProtocolError::ParentJobMismatch
        );
        require!(parent.active_children > 0, AgentProtocolError::Overflow);
        parent.active_children = parent.active_children
            .checked_sub(1)
            .ok_or(AgentProtocolError::Overflow)?;
    }

    emit!(PaymentReleased {
        job: ctx.accounts.job.key(),
        agent: ctx.accounts.agent.key(),
        amount: escrow_amount,
        auto_released: false,
        token_mint: token_mint_key,
    });

    Ok(())
}
