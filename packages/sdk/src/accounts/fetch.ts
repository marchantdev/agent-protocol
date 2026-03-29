import { PublicKey } from '@solana/web3.js';
import type { Program } from '@coral-xyz/anchor';
import BN from 'bn.js';
import { getAgentProfilePDA, getStakeVaultPDA, getRatingPDA } from '../pda';
import { parseJobStatus } from '../types/enums';
import { AccountNotFoundError } from '../errors';
import type { AgentProfileAccount, JobAccount, RatingAccount, StakeVaultAccount } from '../types/accounts';

function toBN(val: any): BN {
  return new BN(val.toString());
}

export function parseAgentProfile(address: PublicKey, raw: any): AgentProfileAccount {
  return {
    address,
    owner: raw.owner,
    name: raw.name,
    description: raw.description,
    capabilities: raw.capabilities,
    priceLamports: toBN(raw.priceLamports),
    isActive: raw.isActive,
    ratingSum: toBN(raw.ratingSum),
    ratingCount: Number(raw.ratingCount),
    jobsCompleted: Number(raw.jobsCompleted),
    createdAt: toBN(raw.createdAt),
    bump: raw.bump,
    jobNonce: toBN(raw.jobNonce),
    stakeAmount: toBN(raw.stakeAmount),
  };
}

export function parseJob(address: PublicKey, raw: any): JobAccount {
  return {
    address,
    client: raw.client,
    agent: raw.agent,
    escrowAmount: toBN(raw.escrowAmount),
    status: parseJobStatus(raw.status),
    description: raw.description,
    resultUri: raw.resultUri,
    parentJob: raw.parentJob ?? null,
    activeChildren: Number(raw.activeChildren),
    autoReleaseAt: raw.autoReleaseAt ? toBN(raw.autoReleaseAt) : null,
    disputedAt: raw.disputedAt ? toBN(raw.disputedAt) : null,
    createdAt: toBN(raw.createdAt),
    completedAt: raw.completedAt ? toBN(raw.completedAt) : null,
    nonceSeed: toBN(raw.nonceSeed),
    bump: raw.bump,
    tokenMint: raw.tokenMint ?? null,
    escrowVault: raw.escrowVault ?? null,
    arbiter: raw.arbiter ?? null,
    arbiterFeeBps: Number(raw.arbiterFeeBps),
  };
}

export function parseRating(address: PublicKey, raw: any): RatingAccount {
  return {
    address,
    agent: raw.agent,
    rater: raw.rater,
    job: raw.job,
    score: raw.score,
    createdAt: toBN(raw.createdAt),
    bump: raw.bump,
  };
}

export function parseStakeVault(address: PublicKey, raw: any): StakeVaultAccount {
  return {
    address,
    agentProfile: raw.agentProfile,
    amount: toBN(raw.amount),
    bump: raw.bump,
  };
}

export async function fetchAgent(program: Program<any>, owner: PublicKey): Promise<AgentProfileAccount> {
  const [pda] = getAgentProfilePDA(owner);
  try {
    const raw = await (program.account as any).agentProfile.fetch(pda);
    return parseAgentProfile(pda, raw);
  } catch {
    throw new AccountNotFoundError('AgentProfile', pda);
  }
}

export async function fetchAgentByPDA(program: Program<any>, pda: PublicKey): Promise<AgentProfileAccount> {
  try {
    const raw = await (program.account as any).agentProfile.fetch(pda);
    return parseAgentProfile(pda, raw);
  } catch {
    throw new AccountNotFoundError('AgentProfile', pda);
  }
}

export async function fetchJob(program: Program<any>, jobPDA: PublicKey): Promise<JobAccount> {
  try {
    const raw = await (program.account as any).job.fetch(jobPDA);
    return parseJob(jobPDA, raw);
  } catch {
    throw new AccountNotFoundError('Job', jobPDA);
  }
}

export async function fetchRating(program: Program<any>, jobPDA: PublicKey): Promise<RatingAccount> {
  const [ratingPDA] = getRatingPDA(jobPDA);
  try {
    const raw = await (program.account as any).rating.fetch(ratingPDA);
    return parseRating(ratingPDA, raw);
  } catch {
    throw new AccountNotFoundError('Rating', ratingPDA);
  }
}

export async function fetchStakeVault(program: Program<any>, agentProfilePDA: PublicKey): Promise<StakeVaultAccount> {
  const [vaultPDA] = getStakeVaultPDA(agentProfilePDA);
  try {
    const raw = await (program.account as any).stakeVault.fetch(vaultPDA);
    return parseStakeVault(vaultPDA, raw);
  } catch {
    throw new AccountNotFoundError('StakeVault', vaultPDA);
  }
}

export async function fetchAllAgents(program: Program<any>, filters?: { isActive?: boolean }): Promise<AgentProfileAccount[]> {
  const all = await (program.account as any).agentProfile.all();
  let results = all.map((item: any) => parseAgentProfile(item.publicKey, item.account));
  if (filters?.isActive !== undefined) {
    results = results.filter((a: AgentProfileAccount) => a.isActive === filters.isActive);
  }
  return results;
}

export async function fetchAllJobs(program: Program<any>): Promise<JobAccount[]> {
  const all = await (program.account as any).job.all();
  return all.map((item: any) => parseJob(item.publicKey, item.account));
}
