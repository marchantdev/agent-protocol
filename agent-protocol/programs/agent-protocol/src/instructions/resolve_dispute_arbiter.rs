use anchor_lang::prelude::*;
use anchor_lang::AccountDeserialize;
use anchor_spl::token;
use anchor_spl::token::TokenAccount as SplTokenAccount;
use crate::state::{AgentProfile, Job, JobStatus, StakeVault};
use crate::error::AgentProtocolError;
use crate::events::{DisputeResolved, StakeSlashed};
use crate::constants::{SLASH_BPS, BPS_DENOMINATOR};
use crate::events::ArbiterPaid;

#[derive(Accounts)]
pub struct ResolveDisputeByArbiter<'info> {
    #[account(mut)]
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
        close = client,
        constraint = job.arbiter == Some(arbiter.key()) @ AgentProtocolError::InvalidArbiter
    )]
    pub job: Account<'info, Job>,
    /// Optional stake vault for slashing
    #[account(mut)]
    pub stake_vault: Option<Account<'info, StakeVault>>,
}

/// Arbiter resolves a dispute, favoring either agent or client.
/// Arbiter receives their fee (arbiter_fee_bps) from the escrow.
///
/// If `favor_agent` is true: escrow remainder goes to agent, agent gets job_completed credit.
/// If `favor_agent` is false: escrow remainder goes to client, agent stake gets slashed.
///
/// For SOL jobs: arbiter receives SOL fee directly.
/// For SPL token jobs, provide four remaining accounts:
/// `[escrow_vault, recipient_token_account, token_program, arbiter_token_account]`.
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
    let arbiter_fee_bps = ctx.accounts.job.arbiter_fee_bps as u64;

    // Calculate arbiter fee
    let arbiter_fee = escrow_amount
        .checked_mul(arbiter_fee_bps)
        .ok_or(AgentProtocolError::Overflow)?
        .checked_div(BPS_DENOMINATOR as u64)
        .ok_or(AgentProtocolError::Overflow)?;
    let payout_amount = escrow_amount
        .checked_sub(arbiter_fee)
        .ok_or(AgentProtocolError::Overflow)?;

    ctx.accounts.job.status = JobStatus::Finalized;
    ctx.accounts.job.escrow_amount = 0;

    let recipient = if favor_agent {
        ctx.accounts.agent.to_account_info()
    } else {
        ctx.accounts.client.to_account_info()
    };

    if is_token_job {
        let min_accounts = if arbiter_fee > 0 { 4 } else { 3 };
        require!(
            ctx.remaining_accounts.len() >= min_accounts,
            AgentProtocolError::MissingTokenAccounts
        );

        let escrow_vault_info = &ctx.remaining_accounts[0];
        let recipient_token_info = &ctx.remaining_accounts[1];
        let token_prog_info = &ctx.remaining_accounts[2];

        require!(
            *token_prog_info.key == anchor_spl::token::ID,
            AgentProtocolError::InvalidTokenAccounts
        );
        require!(
            ctx.accounts.job.escrow_vault == Some(escrow_vault_info.key()),
            AgentProtocolError::EscrowVaultMismatch
        );

        // Validate recipient token account belongs to the favored party
        let expected_recipient = if favor_agent {
            ctx.accounts.agent.key()
        } else {
            ctx.accounts.client.key()
        };
        {
            let recipient_data = recipient_token_info.try_borrow_data()?;
            let recipient_acct = SplTokenAccount::try_deserialize(&mut &recipient_data[..])
                .map_err(|_| error!(AgentProtocolError::InvalidTokenAccounts))?;
            require!(
                recipient_acct.owner == expected_recipient,
                AgentProtocolError::InvalidTokenAccounts
            );
        }

        let seeds: &[&[u8]] = &[
            b"job",
            client_key.as_ref(),
            agent_profile_key.as_ref(),
            &nonce_bytes,
            &[bump],
        ];
        let signer = &[seeds];

        // Pay winner
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
            payout_amount,
        )?;

        // Pay arbiter fee
        if arbiter_fee > 0 {
            let arbiter_token_info = &ctx.remaining_accounts[3];
            {
                let arbiter_token_data = arbiter_token_info.try_borrow_data()?;
                let arbiter_token_acct = SplTokenAccount::try_deserialize(&mut &arbiter_token_data[..])
                    .map_err(|_| error!(AgentProtocolError::InvalidTokenAccounts))?;
                require!(
                    arbiter_token_acct.owner == ctx.accounts.arbiter.key(),
                    AgentProtocolError::InvalidTokenAccounts
                );
            }
            token::transfer(
                CpiContext::new_with_signer(
                    token_prog_info.to_account_info(),
                    token::Transfer {
                        from: escrow_vault_info.to_account_info(),
                        to: arbiter_token_info.to_account_info(),
                        authority: ctx.accounts.job.to_account_info(),
                    },
                    signer,
                ),
                arbiter_fee,
            )?;
        }

        // Close the escrow vault, return rent to client
        token::close_account(
            CpiContext::new_with_signer(
                token_prog_info.to_account_info(),
                token::CloseAccount {
                    account: escrow_vault_info.to_account_info(),
                    destination: ctx.accounts.client.to_account_info(),
                    authority: ctx.accounts.job.to_account_info(),
                },
                signer,
            ),
        )?;
    } else {
        // SOL: pay winner + arbiter
        let job_info = ctx.accounts.job.to_account_info();
        **job_info.try_borrow_mut_lamports()? -= escrow_amount;
        **recipient.try_borrow_mut_lamports()? += payout_amount;
        if arbiter_fee > 0 {
            let arbiter_info = ctx.accounts.arbiter.to_account_info();
            **arbiter_info.try_borrow_mut_lamports()? += arbiter_fee;
        }
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

                    // Cap slash to maintain rent exemption
                    let min_rent = Rent::get()?.minimum_balance(vault_info.data_len());
                    let max_slash = vault_info.lamports().saturating_sub(min_rent);
                    let actual_slash = slash_amount.min(max_slash);

                    if actual_slash > 0 {
                        **vault_info.try_borrow_mut_lamports()? -= actual_slash;
                        **client_info.try_borrow_mut_lamports()? += actual_slash;

                        stake_vault.amount = stake_vault.amount
                            .checked_sub(actual_slash)
                            .ok_or(AgentProtocolError::Overflow)?;
                        ctx.accounts.agent_profile.stake_amount = ctx.accounts.agent_profile.stake_amount
                            .checked_sub(actual_slash)
                            .ok_or(AgentProtocolError::Overflow)?;

                        emit!(StakeSlashed {
                            agent: ctx.accounts.agent_profile.key(),
                            job: ctx.accounts.job.key(),
                            slash_amount: actual_slash,
                            remaining_stake: stake_vault.amount,
                        });
                    }
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

    if arbiter_fee > 0 {
        emit!(ArbiterPaid {
            arbiter: ctx.accounts.arbiter.key(),
            job: ctx.accounts.job.key(),
            fee_amount: arbiter_fee,
        });
    }

    emit!(DisputeResolved {
        job: ctx.accounts.job.key(),
        refund_amount: payout_amount,
        resolved_by: ctx.accounts.arbiter.key(),
    });

    Ok(())
}
