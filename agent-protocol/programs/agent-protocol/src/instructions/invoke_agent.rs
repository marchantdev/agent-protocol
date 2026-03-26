use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token;
use crate::state::{AgentProfile, Job, JobStatus};
use crate::error::AgentProtocolError;
use crate::events::JobCreated;

#[derive(Accounts)]
#[instruction(description: String, payment_amount: u64, auto_release_seconds: Option<i64>, nonce: u64)]
pub struct InvokeAgent<'info> {
    #[account(mut)]
    pub client: Signer<'info>,
    #[account(
        mut,
        constraint = agent_profile.is_active @ AgentProtocolError::AgentNotActive
    )]
    pub agent_profile: Account<'info, AgentProfile>,
    #[account(
        init,
        payer = client,
        space = 8 + Job::INIT_SPACE,
        seeds = [
            b"job",
            client.key().as_ref(),
            agent_profile.key().as_ref(),
            &nonce.to_le_bytes()
        ],
        bump
    )]
    pub job: Account<'info, Job>,
    pub system_program: Program<'info, System>,
}

/// Create a job and escrow payment (SOL or SPL token).
///
/// For SPL token jobs, pass `token_mint = Some(mint_pubkey)` and provide
/// four remaining accounts: `[token_mint, client_token_account, escrow_vault, token_program]`.
/// The escrow vault must be a token account with authority set to the Job PDA.
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, InvokeAgent<'info>>,
    description: String,
    payment_amount: u64,
    auto_release_seconds: Option<i64>,
    nonce: u64,
    token_mint: Option<Pubkey>,
    arbiter: Option<Pubkey>,
) -> Result<()> {
    require!(!description.is_empty(), AgentProtocolError::EmptyDescription);
    require!(description.len() <= 256, AgentProtocolError::DescriptionTooLong);
    require!(
        payment_amount >= ctx.accounts.agent_profile.price_lamports,
        AgentProtocolError::InsufficientPayment
    );

    // Validate and increment nonce
    let profile = &mut ctx.accounts.agent_profile;
    require!(nonce == profile.job_nonce, AgentProtocolError::InvalidNonce);
    profile.job_nonce = profile.job_nonce
        .checked_add(1)
        .ok_or(AgentProtocolError::Overflow)?;

    let clock = Clock::get()?;

    // Handle payment: SOL or SPL token
    let (mint_key, vault_key) = if let Some(mint) = token_mint {
        require!(
            ctx.remaining_accounts.len() >= 4,
            AgentProtocolError::MissingTokenAccounts
        );

        let token_mint_info = &ctx.remaining_accounts[0];
        let client_token_info = &ctx.remaining_accounts[1];
        let escrow_vault_info = &ctx.remaining_accounts[2];
        let token_prog_info = &ctx.remaining_accounts[3];

        require!(
            token_mint_info.key() == mint,
            AgentProtocolError::InvalidTokenAccounts
        );
        require!(
            *token_prog_info.key == anchor_spl::token::ID,
            AgentProtocolError::InvalidTokenAccounts
        );

        // Transfer tokens from client to escrow vault
        token::transfer(
            CpiContext::new(
                token_prog_info.to_account_info(),
                token::Transfer {
                    from: client_token_info.to_account_info(),
                    to: escrow_vault_info.to_account_info(),
                    authority: ctx.accounts.client.to_account_info(),
                },
            ),
            payment_amount,
        )?;

        (Some(mint), Some(escrow_vault_info.key()))
    } else {
        // SOL job — transfer lamports to Job PDA
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.client.to_account_info(),
                    to: ctx.accounts.job.to_account_info(),
                },
            ),
            payment_amount,
        )?;

        (None, None)
    };

    let auto_release_at = auto_release_seconds.map(|s| clock.unix_timestamp + s);

    let job = &mut ctx.accounts.job;
    job.client = ctx.accounts.client.key();
    job.agent = profile.owner;
    job.escrow_amount = payment_amount;
    job.status = JobStatus::Pending;
    job.description = description;
    job.result_uri = String::new();
    job.parent_job = None;
    job.active_children = 0;
    job.auto_release_at = auto_release_at;
    job.disputed_at = None;
    job.created_at = clock.unix_timestamp;
    job.completed_at = None;
    job.nonce_seed = nonce;
    job.bump = ctx.bumps.job;
    job.token_mint = mint_key;
    job.escrow_vault = vault_key;
    job.arbiter = arbiter;

    emit!(JobCreated {
        job: job.key(),
        client: ctx.accounts.client.key(),
        agent: profile.owner,
        escrow_amount: payment_amount,
        token_mint: mint_key,
        auto_release_at,
    });

    Ok(())
}
