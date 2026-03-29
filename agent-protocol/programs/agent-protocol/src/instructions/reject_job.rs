use anchor_lang::prelude::*;
use anchor_lang::AccountDeserialize;
use anchor_spl::token;
use anchor_spl::token::TokenAccount as SplTokenAccount;
use crate::state::{Job, JobStatus};
use crate::error::AgentProtocolError;
use crate::events::JobRejected;

#[derive(Accounts)]
pub struct RejectJob<'info> {
    #[account(
        constraint = job.agent == agent.key() @ AgentProtocolError::Unauthorized
    )]
    pub agent: Signer<'info>,
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
}

/// Agent rejects a pending job, refunding escrow to client.
///
/// For SPL token jobs, provide four remaining accounts:
/// `[escrow_vault, client_token_account, token_program, agent_profile]`.
pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, RejectJob<'info>>) -> Result<()> {
    require!(
        ctx.accounts.job.status == JobStatus::Pending,
        AgentProtocolError::InvalidJobStatus
    );

    let refund_amount = ctx.accounts.job.escrow_amount;
    let is_token_job = ctx.accounts.job.token_mint.is_some();
    let nonce_bytes = ctx.accounts.job.nonce_seed.to_le_bytes();
    let bump = ctx.accounts.job.bump;
    let client_key = ctx.accounts.job.client;

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
        require!(
            ctx.accounts.job.escrow_vault == Some(escrow_vault_info.key()),
            AgentProtocolError::EscrowVaultMismatch
        );

        // Validate client token account belongs to client
        {
            let client_token_data = client_token_info.try_borrow_data()?;
            let client_token_acct = SplTokenAccount::try_deserialize(&mut &client_token_data[..])
                .map_err(|_| error!(AgentProtocolError::InvalidTokenAccounts))?;
            require!(
                client_token_acct.owner == ctx.accounts.client.key(),
                AgentProtocolError::InvalidTokenAccounts
            );
        }

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
        let job_info = ctx.accounts.job.to_account_info();
        let client_info = ctx.accounts.client.to_account_info();
        **job_info.try_borrow_mut_lamports()? -= refund_amount;
        **client_info.try_borrow_mut_lamports()? += refund_amount;
    }

    emit!(JobRejected {
        job: ctx.accounts.job.key(),
        agent: ctx.accounts.agent.key(),
        refund_amount,
    });

    Ok(())
}
