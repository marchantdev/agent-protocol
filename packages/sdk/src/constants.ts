import { PublicKey } from '@solana/web3.js';

export const PROGRAM_ID = new PublicKey('GEtqx8oSqZeuEnMKmXMPCiDsXuQBoVk1q72SyTWxJYUG');

export const SEEDS = {
  AGENT: Buffer.from('agent'),
  JOB: Buffer.from('job'),
  RATING: Buffer.from('rating'),
  STAKE: Buffer.from('stake'),
} as const;

export const DISPUTE_TIMEOUT = 604_800;
export const MAX_ACTIVE_CHILDREN = 8;
export const MIN_STAKE_LAMPORTS = 100_000_000;
export const SLASH_BPS = 5_000;
export const BPS_DENOMINATOR = 10_000;
export const MAX_ARBITER_FEE_BPS = 2_500;
