use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("GEtqx8oSqZeuEnMKmXMPCiDsXuQBoVk1q72SyTWxJYUG");

#[program]
pub mod agent_protocol {
    use super::*;

    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        name: String,
        description: String,
        capabilities: u16,
        price_lamports: u64,
    ) -> Result<()> {
        instructions::register_agent::handler(ctx, name, description, capabilities, price_lamports)
    }

    pub fn invoke_agent<'info>(
        ctx: Context<'_, '_, 'info, 'info, InvokeAgent<'info>>,
        description: String,
        payment_amount: u64,
        auto_release_seconds: Option<i64>,
        nonce: u64,
        token_mint: Option<Pubkey>,
        arbiter: Option<Pubkey>,
    ) -> Result<()> {
        instructions::invoke_agent::handler(
            ctx,
            description,
            payment_amount,
            auto_release_seconds,
            nonce,
            token_mint,
            arbiter,
        )
    }

    pub fn update_job(ctx: Context<UpdateJob>, result_uri: String) -> Result<()> {
        instructions::update_job::handler(ctx, result_uri)
    }

    pub fn release_payment<'info>(
        ctx: Context<'_, '_, 'info, 'info, ReleasePayment<'info>>,
    ) -> Result<()> {
        instructions::release_payment::handler(ctx)
    }

    pub fn auto_release<'info>(
        ctx: Context<'_, '_, 'info, 'info, AutoRelease<'info>>,
    ) -> Result<()> {
        instructions::auto_release::handler(ctx)
    }

    pub fn cancel_job<'info>(
        ctx: Context<'_, '_, 'info, 'info, CancelJob<'info>>,
    ) -> Result<()> {
        instructions::cancel_job::handler(ctx)
    }

    pub fn delegate_task<'info>(
        ctx: Context<'_, '_, 'info, 'info, DelegateTask<'info>>,
        description: String,
        delegation_amount: u64,
        nonce: u64,
    ) -> Result<()> {
        instructions::delegate_task::handler(ctx, description, delegation_amount, nonce)
    }

    pub fn raise_dispute(ctx: Context<RaiseDispute>) -> Result<()> {
        instructions::raise_dispute::handler(ctx)
    }

    pub fn resolve_dispute_by_timeout<'info>(
        ctx: Context<'_, '_, 'info, 'info, ResolveDispute<'info>>,
    ) -> Result<()> {
        instructions::resolve_dispute::handler(ctx)
    }

    pub fn rate_agent(ctx: Context<RateAgent>, score: u8) -> Result<()> {
        instructions::rate_agent::handler(ctx, score)
    }

    // ── v2 Instructions ──

    pub fn stake_agent(ctx: Context<StakeAgent>, amount: u64) -> Result<()> {
        instructions::stake_agent::handler(ctx, amount)
    }

    pub fn unstake_agent(ctx: Context<UnstakeAgent>, amount: u64) -> Result<()> {
        instructions::unstake_agent::handler(ctx, amount)
    }

    pub fn resolve_dispute_by_arbiter<'info>(
        ctx: Context<'_, '_, 'info, 'info, ResolveDisputeByArbiter<'info>>,
        favor_agent: bool,
    ) -> Result<()> {
        instructions::resolve_dispute_arbiter::handler(ctx, favor_agent)
    }

    pub fn update_agent(
        ctx: Context<UpdateAgent>,
        name: Option<String>,
        description: Option<String>,
        capabilities: Option<u16>,
        price_lamports: Option<u64>,
        is_active: Option<bool>,
    ) -> Result<()> {
        instructions::update_agent::handler(ctx, name, description, capabilities, price_lamports, is_active)
    }
}
