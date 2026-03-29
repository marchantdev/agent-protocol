import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { JobStatus } from './enums';

export interface AgentProfileAccount {
  address: PublicKey;
  owner: PublicKey;
  name: string;
  description: string;
  capabilities: number;
  priceLamports: BN;
  isActive: boolean;
  ratingSum: BN;
  ratingCount: number;
  jobsCompleted: number;
  createdAt: BN;
  bump: number;
  jobNonce: BN;
  stakeAmount: BN;
}

export interface JobAccount {
  address: PublicKey;
  client: PublicKey;
  agent: PublicKey;
  escrowAmount: BN;
  status: JobStatus;
  description: string;
  resultUri: string;
  parentJob: PublicKey | null;
  activeChildren: number;
  autoReleaseAt: BN | null;
  disputedAt: BN | null;
  createdAt: BN;
  completedAt: BN | null;
  nonceSeed: BN;
  bump: number;
  tokenMint: PublicKey | null;
  escrowVault: PublicKey | null;
  arbiter: PublicKey | null;
  arbiterFeeBps: number;
}

export interface RatingAccount {
  address: PublicKey;
  agent: PublicKey;
  rater: PublicKey;
  job: PublicKey;
  score: number;
  createdAt: BN;
  bump: number;
}

export interface StakeVaultAccount {
  address: PublicKey;
  agentProfile: PublicKey;
  amount: BN;
  bump: number;
}
