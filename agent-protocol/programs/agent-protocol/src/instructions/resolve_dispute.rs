use anchor_lang::prelude::*;
use anchor_spl::token;
use crate::state::{AgentProfile, Job, JobStatus, StakeVault};
use crate::error::AgentProtocolError;
use crate::events::{DisputeResolved, StakeSlashed};
use crate::constants::{DISPUTE_TIMEOUT, SLASH_BPS, BPS_DENOMINATOR};

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    /// CHECK: Client receives refund. Validated against job.client.
    #[account(
        mut,
        constraint = job.client == client.key() @ AgentProtocolError::Unauthorized
    )]
    pub client: AccountInfo<'info>,
    #[account(
        mut,
        close = client
    )]
    pub job: Account<'info, Job>,
    /// Optional stake vault for slashing agent collateral
    #[account(mut)]
    pub stake_vault: Option<Account<'info, StakeVault>>,
    /// Optional agent profile (required if stake_vault is provided)
    #[account(mut)]
    pub agent_profile: Option<Account<'info, AgentProfile>>,
}

/// Resolve a dispute by timeout (7 days). Refunds escrow to client.
/// Optionally slashes agent stake if stake_vault is provided.
///
/// For SPL token jobs, provide four remaining accounts:
/// `[escrow_vault, client_token_account, token_program, agent_profile_for_seeds]`.
pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, ResolveDispute<'info>>) -> Result<()> {
    require!(
        ctx.accounts.job.status == JobStatus::Disputed,
        AgentProtocolError::InvalidJobStatus
    );
    require!(
        ctx.accounts.job.disputed_at.is_some(),
        AgentProtocolError::InvalidJobStatus
    );

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp - ctx.accounts.job.disputed_at.unwrap() > DISPUTE_TIMEOUT,
        AgentProtocolError::DisputeTimeoutNotReached
    );

    let refund_amount = ctx.accounts.job.escrow_amount;
    let is_token_job = ctx.accounts.job.token_mint.is_some();
    let nonce_bytes = ctx.accounts.job.nonce_seed.to_le_bytes();
    let bump = ctx.accounts.job.bump;
    let client_key = ctx.accounts.job.client;
    let job_agent = ctx.accounts.job.agent;

    ctx.accounts.job.status = JobStatus::Cancelled;
    ctx.accounts.job.escrow_amount = 0;

    if is_token_job {
        require!(
            ctx.remaining_accounts.len() >= 4,
            AgentProtocolError::MissingTokenAccounts
        );

        let escrow_vault_info = &ctx.remaining_accounts[0];
        let client_token_info = &ctx.remaining_accounts[1];
        let token_prog_info = &ctx.remaining_accounts[2];
        let agent_profile_info = &ctx.remaining_accounts[3];

        require!(
            *token_prog_info.key == anchor_spl::token::ID,
            AgentProtocolError::InvalidTokenAccounts
        );

        let seeds: &[&[u8]] = &[
            b"job",
            client_key.as_ref(),
            agent_profile_info.key.as_ref(),
            &nonce_bytes,
            &[bump],
        ];
        let signer = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                token_prog_info.to_account_info(),
                token::Transfer {
                    from: escrow_vault_info.to_account_info(),
                    to: client_token_info.to_account_info(),
                    authority: ctx.accounts.job.to_account_info(),
                },
                signer,
            ),
            refund_amount,
        )?;
    } else {
        let job_info = ctx.accounts.job.to_account_info();
        let client_info = ctx.accounts.client.to_account_info();
        **job_info.try_borrow_mut_lamports()? -= refund_amount;
        **client_info.try_borrow_mut_lamports()? += refund_amount;
    }

    // Slash agent stake if vault is provided
    if let (Some(stake_vault), Some(agent_profile)) = (
        ctx.accounts.stake_vault.as_mut(),
        ctx.accounts.agent_profile.as_mut(),
    ) {
        // Validate the optional accounts belong to the job's agent
        require!(agent_profile.owner == job_agent, AgentProtocolError::Unauthorized);
        require!(stake_vault.agent_profile == agent_profile.key(), AgentProtocolError::Unauthorized);

        if stake_vault.amount > 0 {
            let slash_amount = stake_vault.amount
                .checked_mul(SLASH_BPS)
                .ok_or(AgentProtocolError::Overflow)?
                .checked_div(BPS_DENOMINATOR)
                .ok_or(AgentProtocolError::Overflow)?;

            if slash_amount > 0 {
                let vault_info = stake_vault.to_account_info();
                let client_info = ctx.accounts.client.to_account_info();
                **vault_info.try_borrow_mut_lamports()? -= slash_amount;
                **client_info.try_borrow_mut_lamports()? += slash_amount;

                stake_vault.amount = stake_vault.amount
                    .checked_sub(slash_amount)
                    .ok_or(AgentProtocolError::Overflow)?;
                agent_profile.stake_amount = agent_profile.stake_amount
                    .checked_sub(slash_amount)
                    .ok_or(AgentProtocolError::Overflow)?;

                emit!(StakeSlashed {
                    agent: agent_profile.key(),
                    job: ctx.accounts.job.key(),
                    slash_amount,
                    remaining_stake: stake_vault.amount,
                });
            }
        }
    }

    emit!(DisputeResolved {
        job: ctx.accounts.job.key(),
        refund_amount,
        resolved_by: ctx.accounts.client.key(),
    });

    Ok(())
}
