import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

export interface RegisterAgentParams {
  name: string;
  description: string;
  capabilities: number;
  priceLamports: BN | number;
}

export interface UpdateAgentParams {
  name?: string;
  description?: string;
  capabilities?: number;
  priceLamports?: BN | number;
  isActive?: boolean;
}

export interface InvokeAgentParams {
  agentOwner: PublicKey;
  description: string;
  paymentAmount: BN | number;
  autoReleaseSeconds?: number;
  tokenMint?: PublicKey;
  arbiter?: PublicKey;
  arbiterFeeBps?: number;
}

export interface UpdateJobParams {
  job: PublicKey;
  resultUri: string;
}

export interface ReleasePaymentParams {
  job: PublicKey;
}

export interface AutoReleaseParams {
  job: PublicKey;
}

export interface CancelJobParams {
  job: PublicKey;
}

export interface RejectJobParams {
  job: PublicKey;
}

export interface CloseJobParams {
  job: PublicKey;
}

export interface DelegateTaskParams {
  parentJob: PublicKey;
  subAgentOwner: PublicKey;
  description: string;
  delegationAmount: BN | number;
  tokenMint?: PublicKey;
}

export interface RaiseDisputeParams {
  job: PublicKey;
}

export interface ResolveDisputeByTimeoutParams {
  job: PublicKey;
}

export interface ResolveDisputeByArbiterParams {
  job: PublicKey;
  favorAgent: boolean;
}

export interface RateAgentParams {
  job: PublicKey;
  score: 1 | 2 | 3 | 4 | 5;
}

export interface StakeAgentParams {
  amount: BN | number;
}

export interface UnstakeAgentParams {
  amount: BN | number;
}
