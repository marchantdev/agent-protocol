import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

export interface AgentRegisteredEvent {
  agent: PublicKey;
  owner: PublicKey;
  name: string;
  priceLamports: BN;
}

export interface AgentUpdatedEvent {
  agent: PublicKey;
  owner: PublicKey;
  name: string;
}

export interface JobCreatedEvent {
  job: PublicKey;
  client: PublicKey;
  agent: PublicKey;
  escrowAmount: BN;
  tokenMint: PublicKey | null;
  autoReleaseAt: BN | null;
}

export interface JobCompletedEvent {
  job: PublicKey;
  agent: PublicKey;
  resultUri: string;
}

export interface JobCancelledEvent {
  job: PublicKey;
  client: PublicKey;
  refundAmount: BN;
}

export interface JobRejectedEvent {
  job: PublicKey;
  agent: PublicKey;
  refundAmount: BN;
}

export interface JobDelegatedEvent {
  parentJob: PublicKey;
  childJob: PublicKey;
  delegatingAgent: PublicKey;
  subAgent: PublicKey;
  amount: BN;
}

export interface PaymentReleasedEvent {
  job: PublicKey;
  agent: PublicKey;
  amount: BN;
  autoReleased: boolean;
  tokenMint: PublicKey | null;
}

export interface DisputeRaisedEvent {
  job: PublicKey;
  raisedBy: PublicKey;
}

export interface DisputeResolvedEvent {
  job: PublicKey;
  refundAmount: BN;
  resolvedBy: PublicKey;
}

export interface AgentRatedEvent {
  agent: PublicKey;
  rater: PublicKey;
  score: number;
  newAvgX100: BN;
}

export interface AgentStakedEvent {
  agent: PublicKey;
  amount: BN;
  totalStake: BN;
}

export interface AgentUnstakedEvent {
  agent: PublicKey;
  amount: BN;
  remainingStake: BN;
}

export interface StakeSlashedEvent {
  agent: PublicKey;
  job: PublicKey;
  slashAmount: BN;
  remainingStake: BN;
}

export interface ArbiterPaidEvent {
  arbiter: PublicKey;
  job: PublicKey;
  feeAmount: BN;
}

export interface AgentProtocolEventMap {
  AgentRegistered: AgentRegisteredEvent;
  AgentUpdated: AgentUpdatedEvent;
  JobCreated: JobCreatedEvent;
  JobCompleted: JobCompletedEvent;
  JobCancelled: JobCancelledEvent;
  JobRejected: JobRejectedEvent;
  JobDelegated: JobDelegatedEvent;
  PaymentReleased: PaymentReleasedEvent;
  DisputeRaised: DisputeRaisedEvent;
  DisputeResolved: DisputeResolvedEvent;
  AgentRated: AgentRatedEvent;
  AgentStaked: AgentStakedEvent;
  AgentUnstaked: AgentUnstakedEvent;
  StakeSlashed: StakeSlashedEvent;
  ArbiterPaid: ArbiterPaidEvent;
}

export type AgentProtocolEventName = keyof AgentProtocolEventMap;
