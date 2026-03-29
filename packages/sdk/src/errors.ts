import { PublicKey } from '@solana/web3.js';

export class AgentProtocolError extends Error {
  constructor(message: string, public readonly code?: number) {
    super(message);
    this.name = 'AgentProtocolError';
  }
}

export class AccountNotFoundError extends AgentProtocolError {
  constructor(public readonly accountType: string, public readonly address: PublicKey) {
    super(`${accountType} account not found: ${address.toBase58()}`);
    this.name = 'AccountNotFoundError';
  }
}

export const ERROR_MAP: Record<number, string> = {
  6000: 'NameTooLong',
  6001: 'DescriptionTooLong',
  6002: 'InvalidPrice',
  6003: 'AgentNotActive',
  6004: 'InsufficientPayment',
  6005: 'InvalidJobStatus',
  6006: 'Unauthorized',
  6007: 'InvalidRating',
  6008: 'InsufficientEscrow',
  6009: 'EmptyResultUri',
  6010: 'EmptyDescription',
  6011: 'AutoReleaseNotReady',
  6012: 'NoAutoRelease',
  6013: 'DisputeTimeoutNotReached',
  6014: 'UnresolvedChildren',
  6015: 'ParentJobMismatch',
  6016: 'Overflow',
  6017: 'TooManyDelegations',
  6018: 'InvalidNonce',
  6019: 'InvalidTokenAccounts',
  6020: 'InsufficientStake',
  6021: 'InvalidArbiter',
  6022: 'MissingTokenAccounts',
  6023: 'EscrowVaultMismatch',
  6024: 'SelfInvocation',
  6025: 'EmptyName',
  6026: 'ArbiterFeeTooHigh',
  6027: 'ArbiterRequiredForCompletedDispute',
};
