import {
  Connection, PublicKey, Transaction, SystemProgram,
} from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import BN from 'bn.js';
import idl from './idl/agent_protocol.json';

import { PROGRAM_ID } from './constants';
import * as pda from './pda';
import * as accountFetchers from './accounts/fetch';
import { EventSubscription } from './events/subscription';
import {
  buildInvokeAgentSplAccounts,
  buildReleaseSplAccounts,
  buildRefundSplAccounts,
  buildDelegateSplAccounts,
} from './spl/tokenAccounts';

import type {
  WalletAdapter, SendOptions, TransactionResult, InstructionResult,
} from './types/common';
import type {
  RegisterAgentParams, UpdateAgentParams, InvokeAgentParams, UpdateJobParams,
  ReleasePaymentParams, AutoReleaseParams, CancelJobParams, RejectJobParams,
  CloseJobParams, DelegateTaskParams, RaiseDisputeParams,
  ResolveDisputeByTimeoutParams, ResolveDisputeByArbiterParams,
  RateAgentParams, StakeAgentParams, UnstakeAgentParams,
} from './types/inputs';
import type { AgentProfileAccount, JobAccount, RatingAccount, StakeVaultAccount } from './types/accounts';
import type { AgentProtocolEventMap, AgentProtocolEventName } from './types/events';

export interface AgentProtocolConfig {
  connection: Connection;
  wallet: WalletAdapter;
  programId?: PublicKey;
  sendOptions?: SendOptions;
}

function toBN(val: BN | number): BN {
  return BN.isBN(val) ? val : new BN(val);
}

export class AgentProtocolClient {
  public readonly connection: Connection;
  public readonly wallet: WalletAdapter;
  public readonly programId: PublicKey;
  public readonly program: anchor.Program;

  private defaultOpts: SendOptions;

  constructor(config: AgentProtocolConfig) {
    this.connection = config.connection;
    this.wallet = config.wallet;
    this.programId = config.programId ?? PROGRAM_ID;
    this.defaultOpts = config.sendOptions ?? { commitment: 'confirmed' };

    const provider = new anchor.AnchorProvider(
      this.connection,
      this.wallet as any,
      { commitment: this.defaultOpts.commitment ?? 'confirmed' },
    );
    this.program = new anchor.Program(idl as any, provider);
  }

  // ── Internal helpers ──

  private async sendTx(ixResult: InstructionResult, opts?: SendOptions): Promise<TransactionResult> {
    const merged = { ...this.defaultOpts, ...opts };
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash(
      merged.commitment,
    );

    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: this.wallet.publicKey });
    if (ixResult.setupInstructions.length) tx.add(...ixResult.setupInstructions);
    tx.add(ixResult.instruction);

    const signed = await this.wallet.signTransaction(tx);
    if (ixResult.additionalSigners.length) {
      (signed as Transaction).partialSign(...ixResult.additionalSigners);
    }

    const signature = await this.connection.sendRawTransaction(
      (signed as Transaction).serialize(),
      { skipPreflight: merged.skipPreflight ?? false, maxRetries: merged.maxRetries ?? 3 },
    );

    await this.connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      merged.commitment ?? 'confirmed',
    );

    return { signature, accounts: ixResult.accounts };
  }

  private async fetchNonce(agentProfilePDA: PublicKey): Promise<BN> {
    const raw = await (this.program.account as any).agentProfile.fetch(agentProfilePDA);
    return new BN(raw.jobNonce.toString());
  }

  private async fetchJobRaw(jobPDA: PublicKey): Promise<any> {
    return (this.program.account as any).job.fetch(jobPDA);
  }

  // ── High-level methods ──

  async registerAgent(params: RegisterAgentParams, opts?: SendOptions): Promise<TransactionResult> {
    const [profilePDA] = pda.getAgentProfilePDA(this.wallet.publicKey);
    const ix = await this.program.methods
      .registerAgent(params.name, params.description, params.capabilities, toBN(params.priceLamports))
      .accountsPartial({ owner: this.wallet.publicKey })
      .instruction();

    return this.sendTx({
      instruction: ix, additionalSigners: [], setupInstructions: [],
      accounts: { agentProfile: profilePDA },
    }, opts);
  }

  async updateAgent(params: UpdateAgentParams, opts?: SendOptions): Promise<TransactionResult> {
    const [profilePDA] = pda.getAgentProfilePDA(this.wallet.publicKey);
    const ix = await this.program.methods
      .updateAgent(
        params.name ?? null,
        params.description ?? null,
        params.capabilities ?? null,
        params.priceLamports ? toBN(params.priceLamports) : null,
        params.isActive ?? null,
      )
      .accountsPartial({ owner: this.wallet.publicKey, agentProfile: profilePDA })
      .instruction();

    return this.sendTx({
      instruction: ix, additionalSigners: [], setupInstructions: [],
      accounts: { agentProfile: profilePDA },
    }, opts);
  }

  async invokeAgent(params: InvokeAgentParams, opts?: SendOptions): Promise<TransactionResult> {
    const [agentProfilePDA] = pda.getAgentProfilePDA(params.agentOwner);
    const nonce = await this.fetchNonce(agentProfilePDA);
    const [jobPDA] = pda.getJobPDA(this.wallet.publicKey, agentProfilePDA, nonce);

    const autoRelease = params.autoReleaseSeconds ? new BN(params.autoReleaseSeconds) : null;
    const arbiterFeeBps = params.arbiterFeeBps ?? 0;

    let builder = this.program.methods
      .invokeAgent(
        params.description,
        toBN(params.paymentAmount),
        autoRelease,
        nonce,
        params.tokenMint ?? null,
        params.arbiter ?? null,
        arbiterFeeBps,
      )
      .accountsPartial({
        client: this.wallet.publicKey,
        agentProfile: agentProfilePDA,
      });

    const setupInstructions: any[] = [];

    if (params.tokenMint) {
      const spl = await buildInvokeAgentSplAccounts(
        this.connection, params.tokenMint, this.wallet.publicKey, jobPDA, this.wallet.publicKey,
      );
      builder = builder.remainingAccounts(spl.remainingAccounts);
      setupInstructions.push(...spl.setupInstructions);
    }

    const ix = await builder.instruction();

    return this.sendTx({
      instruction: ix, additionalSigners: [], setupInstructions,
      accounts: { agentProfile: agentProfilePDA, job: jobPDA },
    }, opts);
  }

  async updateJob(params: UpdateJobParams, opts?: SendOptions): Promise<TransactionResult> {
    const ix = await this.program.methods
      .updateJob(params.resultUri)
      .accountsPartial({ agent: this.wallet.publicKey, job: params.job })
      .instruction();

    return this.sendTx({
      instruction: ix, additionalSigners: [], setupInstructions: [],
      accounts: { job: params.job },
    }, opts);
  }

  async releasePayment(params: ReleasePaymentParams, opts?: SendOptions): Promise<TransactionResult> {
    const jobRaw = await this.fetchJobRaw(params.job);
    const agentProfilePDA = pda.getAgentProfilePDA(jobRaw.agent)[0];

    let builder = this.program.methods
      .releasePayment()
      .accountsPartial({
        client: this.wallet.publicKey,
        agent: jobRaw.agent,
        agentProfile: agentProfilePDA,
        job: params.job,
        parentJob: jobRaw.parentJob || null,
      });

    const setupInstructions: any[] = [];

    if (jobRaw.tokenMint) {
      const spl = await buildReleaseSplAccounts(
        this.connection, jobRaw.tokenMint, jobRaw.escrowVault, jobRaw.agent, this.wallet.publicKey,
      );
      builder = builder.remainingAccounts(spl.remainingAccounts);
      setupInstructions.push(...spl.setupInstructions);
    }

    const ix = await builder.instruction();

    return this.sendTx({
      instruction: ix, additionalSigners: [], setupInstructions,
      accounts: { job: params.job },
    }, opts);
  }

  async autoRelease(params: AutoReleaseParams, opts?: SendOptions): Promise<TransactionResult> {
    const jobRaw = await this.fetchJobRaw(params.job);
    const agentProfilePDA = pda.getAgentProfilePDA(jobRaw.agent)[0];

    let builder = this.program.methods
      .autoRelease()
      .accountsPartial({
        agent: jobRaw.agent,
        agentProfile: agentProfilePDA,
        job: params.job,
        client: jobRaw.client,
        parentJob: jobRaw.parentJob || null,
      });

    const setupInstructions: any[] = [];

    if (jobRaw.tokenMint) {
      const spl = await buildReleaseSplAccounts(
        this.connection, jobRaw.tokenMint, jobRaw.escrowVault, jobRaw.agent, this.wallet.publicKey,
      );
      builder = builder.remainingAccounts(spl.remainingAccounts);
      setupInstructions.push(...spl.setupInstructions);
    }

    const ix = await builder.instruction();

    return this.sendTx({
      instruction: ix, additionalSigners: [], setupInstructions,
      accounts: { job: params.job },
    }, opts);
  }

  async cancelJob(params: CancelJobParams, opts?: SendOptions): Promise<TransactionResult> {
    const jobRaw = await this.fetchJobRaw(params.job);

    let builder = this.program.methods
      .cancelJob()
      .accountsPartial({ client: this.wallet.publicKey, job: params.job });

    const setupInstructions: any[] = [];

    if (jobRaw.tokenMint) {
      const agentProfilePDA = pda.getAgentProfilePDA(jobRaw.agent)[0];
      const spl = await buildRefundSplAccounts(
        this.connection, jobRaw.tokenMint, jobRaw.escrowVault, this.wallet.publicKey, agentProfilePDA, this.wallet.publicKey,
      );
      builder = builder.remainingAccounts(spl.remainingAccounts);
      setupInstructions.push(...spl.setupInstructions);
    }

    const ix = await builder.instruction();

    return this.sendTx({
      instruction: ix, additionalSigners: [], setupInstructions,
      accounts: { job: params.job },
    }, opts);
  }

  async rejectJob(params: RejectJobParams, opts?: SendOptions): Promise<TransactionResult> {
    const jobRaw = await this.fetchJobRaw(params.job);

    let builder = this.program.methods
      .rejectJob()
      .accountsPartial({ agent: this.wallet.publicKey, client: jobRaw.client, job: params.job });

    const setupInstructions: any[] = [];

    if (jobRaw.tokenMint) {
      const agentProfilePDA = pda.getAgentProfilePDA(jobRaw.agent)[0];
      const spl = await buildRefundSplAccounts(
        this.connection, jobRaw.tokenMint, jobRaw.escrowVault, jobRaw.client, agentProfilePDA, this.wallet.publicKey,
      );
      builder = builder.remainingAccounts(spl.remainingAccounts);
      setupInstructions.push(...spl.setupInstructions);
    }

    const ix = await builder.instruction();

    return this.sendTx({
      instruction: ix, additionalSigners: [], setupInstructions,
      accounts: { job: params.job },
    }, opts);
  }

  async closeJob(params: CloseJobParams, opts?: SendOptions): Promise<TransactionResult> {
    const jobRaw = await this.fetchJobRaw(params.job);

    const ix = await this.program.methods
      .closeJob()
      .accountsPartial({ client: jobRaw.client, job: params.job })
      .instruction();

    return this.sendTx({
      instruction: ix, additionalSigners: [], setupInstructions: [],
      accounts: { job: params.job },
    }, opts);
  }

  async delegateTask(params: DelegateTaskParams, opts?: SendOptions): Promise<TransactionResult> {
    const [subAgentProfilePDA] = pda.getAgentProfilePDA(params.subAgentOwner);
    const nonce = await this.fetchNonce(subAgentProfilePDA);
    const [childJobPDA] = pda.getJobPDA(this.wallet.publicKey, subAgentProfilePDA, nonce);
    const parentJobRaw = await this.fetchJobRaw(params.parentJob);

    let builder = this.program.methods
      .delegateTask(params.description, toBN(params.delegationAmount), nonce)
      .accountsPartial({
        delegatingAgent: this.wallet.publicKey,
        parentJob: params.parentJob,
        subAgentProfile: subAgentProfilePDA,
      });

    const setupInstructions: any[] = [];

    if (params.tokenMint || parentJobRaw.tokenMint) {
      const mint = params.tokenMint ?? parentJobRaw.tokenMint;
      const parentAgentProfilePDA = pda.getAgentProfilePDA(parentJobRaw.agent)[0];
      const spl = await buildDelegateSplAccounts(
        this.connection, mint, parentJobRaw.escrowVault, childJobPDA, parentAgentProfilePDA, this.wallet.publicKey,
      );
      builder = builder.remainingAccounts(spl.remainingAccounts);
      setupInstructions.push(...spl.setupInstructions);
    }

    const ix = await builder.instruction();

    return this.sendTx({
      instruction: ix, additionalSigners: [], setupInstructions,
      accounts: { parentJob: params.parentJob, childJob: childJobPDA, subAgentProfile: subAgentProfilePDA },
    }, opts);
  }

  async raiseDispute(params: RaiseDisputeParams, opts?: SendOptions): Promise<TransactionResult> {
    const ix = await this.program.methods
      .raiseDispute()
      .accountsPartial({ disputant: this.wallet.publicKey, job: params.job })
      .instruction();

    return this.sendTx({
      instruction: ix, additionalSigners: [], setupInstructions: [],
      accounts: { job: params.job },
    }, opts);
  }

  async resolveDisputeByTimeout(params: ResolveDisputeByTimeoutParams, opts?: SendOptions): Promise<TransactionResult> {
    const jobRaw = await this.fetchJobRaw(params.job);

    let builder = this.program.methods
      .resolveDisputeByTimeout()
      .accountsPartial({ client: jobRaw.client, job: params.job });

    const setupInstructions: any[] = [];

    if (jobRaw.tokenMint) {
      const agentProfilePDA = pda.getAgentProfilePDA(jobRaw.agent)[0];
      const spl = await buildRefundSplAccounts(
        this.connection, jobRaw.tokenMint, jobRaw.escrowVault, jobRaw.client, agentProfilePDA, this.wallet.publicKey,
      );
      builder = builder.remainingAccounts(spl.remainingAccounts);
      setupInstructions.push(...spl.setupInstructions);
    }

    const ix = await builder.instruction();

    return this.sendTx({
      instruction: ix, additionalSigners: [], setupInstructions,
      accounts: { job: params.job },
    }, opts);
  }

  async resolveDisputeByArbiter(params: ResolveDisputeByArbiterParams, opts?: SendOptions): Promise<TransactionResult> {
    const jobRaw = await this.fetchJobRaw(params.job);
    const agentProfilePDA = pda.getAgentProfilePDA(jobRaw.agent)[0];
    const [stakeVaultPDA] = pda.getStakeVaultPDA(agentProfilePDA);

    let stakeVault: PublicKey | null = null;
    try {
      await (this.program.account as any).stakeVault.fetch(stakeVaultPDA);
      stakeVault = stakeVaultPDA;
    } catch {
      // no stake vault exists
    }

    let builder = this.program.methods
      .resolveDisputeByArbiter(params.favorAgent)
      .accountsPartial({
        arbiter: this.wallet.publicKey,
        client: jobRaw.client,
        agent: jobRaw.agent,
        agentProfile: agentProfilePDA,
        job: params.job,
        stakeVault: (!params.favorAgent && stakeVault) ? stakeVault : (null as any),
      });

    const setupInstructions: any[] = [];

    if (jobRaw.tokenMint) {
      const recipient = params.favorAgent ? jobRaw.agent : jobRaw.client;
      const spl = await buildReleaseSplAccounts(
        this.connection, jobRaw.tokenMint, jobRaw.escrowVault, recipient, this.wallet.publicKey,
      );
      const remaining = [...spl.remainingAccounts];

      // Add arbiter token account if fee > 0
      if (jobRaw.arbiterFeeBps > 0) {
        const { ensureATA } = await import('./spl/tokenAccounts');
        const { ata, setupIx } = await ensureATA(
          this.connection, jobRaw.tokenMint, this.wallet.publicKey, this.wallet.publicKey,
        );
        if (setupIx) spl.setupInstructions.push(setupIx);
        remaining.push({ pubkey: ata, isSigner: false, isWritable: true });
      }

      builder = builder.remainingAccounts(remaining);
      setupInstructions.push(...spl.setupInstructions);
    }

    const ix = await builder.instruction();

    return this.sendTx({
      instruction: ix, additionalSigners: [], setupInstructions,
      accounts: { job: params.job },
    }, opts);
  }

  async rateAgent(params: RateAgentParams, opts?: SendOptions): Promise<TransactionResult> {
    const jobRaw = await this.fetchJobRaw(params.job);
    const agentProfilePDA = pda.getAgentProfilePDA(jobRaw.agent)[0];
    const [ratingPDA] = pda.getRatingPDA(params.job);

    const ix = await this.program.methods
      .rateAgent(params.score)
      .accountsPartial({
        client: this.wallet.publicKey,
        job: params.job,
        agentProfile: agentProfilePDA,
      })
      .instruction();

    return this.sendTx({
      instruction: ix, additionalSigners: [], setupInstructions: [],
      accounts: { rating: ratingPDA, agentProfile: agentProfilePDA },
    }, opts);
  }

  async stakeAgent(params: StakeAgentParams, opts?: SendOptions): Promise<TransactionResult> {
    const [profilePDA] = pda.getAgentProfilePDA(this.wallet.publicKey);
    const [vaultPDA] = pda.getStakeVaultPDA(profilePDA);

    const ix = await this.program.methods
      .stakeAgent(toBN(params.amount))
      .accountsPartial({ owner: this.wallet.publicKey, agentProfile: profilePDA })
      .instruction();

    return this.sendTx({
      instruction: ix, additionalSigners: [], setupInstructions: [],
      accounts: { agentProfile: profilePDA, stakeVault: vaultPDA },
    }, opts);
  }

  async unstakeAgent(params: UnstakeAgentParams, opts?: SendOptions): Promise<TransactionResult> {
    const [profilePDA] = pda.getAgentProfilePDA(this.wallet.publicKey);
    const [vaultPDA] = pda.getStakeVaultPDA(profilePDA);

    const ix = await this.program.methods
      .unstakeAgent(toBN(params.amount))
      .accountsPartial({ owner: this.wallet.publicKey, agentProfile: profilePDA, stakeVault: vaultPDA })
      .instruction();

    return this.sendTx({
      instruction: ix, additionalSigners: [], setupInstructions: [],
      accounts: { agentProfile: profilePDA, stakeVault: vaultPDA },
    }, opts);
  }

  // ── Account fetchers ──

  async fetchAgent(owner: PublicKey): Promise<AgentProfileAccount> {
    return accountFetchers.fetchAgent(this.program, owner);
  }

  async fetchAgentByPDA(agentProfilePDA: PublicKey): Promise<AgentProfileAccount> {
    return accountFetchers.fetchAgentByPDA(this.program, agentProfilePDA);
  }

  async fetchJob(jobPDA: PublicKey): Promise<JobAccount> {
    return accountFetchers.fetchJob(this.program, jobPDA);
  }

  async fetchRating(jobPDA: PublicKey): Promise<RatingAccount> {
    return accountFetchers.fetchRating(this.program, jobPDA);
  }

  async fetchStakeVault(agentProfilePDA: PublicKey): Promise<StakeVaultAccount> {
    return accountFetchers.fetchStakeVault(this.program, agentProfilePDA);
  }

  async fetchAllAgents(filters?: { isActive?: boolean }): Promise<AgentProfileAccount[]> {
    return accountFetchers.fetchAllAgents(this.program, filters);
  }

  async fetchAllJobs(): Promise<JobAccount[]> {
    return accountFetchers.fetchAllJobs(this.program);
  }

  // ── Events ──

  onEvent<E extends AgentProtocolEventName>(
    eventName: E,
    callback: (event: AgentProtocolEventMap[E], slot: number) => void,
  ): EventSubscription {
    const eventParser = new anchor.EventParser(
      this.programId,
      new anchor.BorshCoder(this.program.idl),
    );
    const sub = new EventSubscription(
      this.connection, eventParser, eventName,
      (_name, data, slot) => callback(data as AgentProtocolEventMap[E], slot),
    );
    sub.start();
    return sub;
  }

  onAllEvents(
    callback: (eventName: AgentProtocolEventName, event: any, slot: number) => void,
  ): EventSubscription {
    const eventParser = new anchor.EventParser(
      this.programId,
      new anchor.BorshCoder(this.program.idl),
    );
    const sub = new EventSubscription(
      this.connection, eventParser, '*',
      (name, data, slot) => callback(name as AgentProtocolEventName, data, slot),
    );
    sub.start();
    return sub;
  }

  // ── Static PDA helpers ──

  static getAgentProfilePDA = pda.getAgentProfilePDA;
  static getJobPDA = pda.getJobPDA;
  static getRatingPDA = pda.getRatingPDA;
  static getStakeVaultPDA = pda.getStakeVaultPDA;
}
