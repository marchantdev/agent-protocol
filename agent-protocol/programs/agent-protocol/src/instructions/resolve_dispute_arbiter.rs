use anchor_lang::prelude::*;
use anchor_spl::token;
use crate::state::{AgentProfile, Job, JobStatus, StakeVault};
use crate::error::AgentProtocolError;
use crate::events::{DisputeResolved, StakeSlashed};
use crate::constants::{SLASH_BPS, BPS_DENOMINATOR};

#[derive(Accounts)]
pub struct ResolveDisputeByArbiter<'info> {
    pub arbiter: Signer<'info>,
    /// CHECK: Client wallet. Validated against job.client.
    #[account(
        mut,
        constraint = job.client == client.key() @ AgentProtocolError::Unauthorized
    )]
    pub client: AccountInfo<'info>,
    /// CHECK: Agent wallet. Validated against job.agent.
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
    #[account(
        mut,
        constraint = job.arbiter == Some(arbiter.key()) @ AgentProtocolError::InvalidArbiter
    )]
    pub job: Account<'info, Job>,
    /// Optional stake vault for slashing
    #[account(mut)]
    pub stake_vault: Option<Account<'info, StakeVault>>,
}

/// Arbiter resolves a dispute, favoring either agent or client.
///
/// If `favor_agent` is true: escrow goes to agent, agent gets job_completed credit.
/// If `favor_agent` is false: escrow goes to client, agent stake gets slashed.
///
/// For SPL token jobs, provide three remaining accounts:
/// `[escrow_vault, recipient_token_account, token_program]`.
pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, ResolveDisputeByArbiter<'info>>, favor_agent: bool) -> Result<()> {
    require!(
        ctx.accounts.job.status == JobStatus::Disputed,
        AgentProtocolError::InvalidJobStatus
    );

    let escrow_amount = ctx.accounts.job.escrow_amount;
    let is_token_job = ctx.accounts.job.token_mint.is_some();
    let nonce_bytes = ctx.accounts.job.nonce_seed.to_le_bytes();
    let bump = ctx.accounts.job.bump;
    let client_key = ctx.accounts.job.client;
    let agent_profile_key = ctx.accounts.agent_profile.key();

    ctx.accounts.job.status = JobStatus::Finalized;
    ctx.accounts.job.escrow_amount = 0;

    let recipient = if favor_agent {
        ctx.accounts.agent.to_account_info()
    } else {
        ctx.accounts.client.to_account_info()
    };

    if is_token_job {
        require!(
            ctx.remaining_accounts.len() >= 3,
            AgentProtocolError::MissingTokenAccounts
        );

        let escrow_vault_info = &ctx.remaining_accounts[0];
        let recipient_token_info = &ctx.remaining_accounts[1];
        let token_prog_info = &ctx.remaining_accounts[2];

        require!(
            *token_prog_info.key == anchor_spl::token::ID,
            AgentProtocolError::InvalidTokenAccounts
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
                    to: recipient_token_info.to_account_info(),
                    authority: ctx.accounts.job.to_account_info(),
                },
                signer,
            ),
            escrow_amount,
        )?;
    } else {
        let job_info = ctx.accounts.job.to_account_info();
        **job_info.try_borrow_mut_lamports()? -= escrow_amount;
        **recipient.try_borrow_mut_lamports()? += escrow_amount;
    }

    // If favoring client, slash agent's stake
    if !favor_agent {
        if let Some(stake_vault) = ctx.accounts.stake_vault.as_mut() {
            // Validate stake vault belongs to the agent
            require!(
                stake_vault.agent_profile == ctx.accounts.agent_profile.key(),
                AgentProtocolError::Unauthorized
            );

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
                    ctx.accounts.agent_profile.stake_amount = ctx.accounts.agent_profile.stake_amount
                        .checked_sub(slash_amount)
                        .ok_or(AgentProtocolError::Overflow)?;

                    emit!(StakeSlashed {
                        agent: ctx.accounts.agent_profile.key(),
                        job: ctx.accounts.job.key(),
                        slash_amount,
                        remaining_stake: stake_vault.amount,
                    });
                }
            }
        }
    }

    // If favoring agent, credit completion
    if favor_agent {
        ctx.accounts.agent_profile.jobs_completed = ctx.accounts.agent_profile.jobs_completed
            .checked_add(1)
            .ok_or(AgentProtocolError::Overflow)?;
    }

    emit!(DisputeResolved {
        job: ctx.accounts.job.key(),
        refund_amount: escrow_amount,
        resolved_by: ctx.accounts.arbiter.key(),
    });

    Ok(())
}
