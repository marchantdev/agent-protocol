import { Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { Capability } from './types/enums';
import { ERROR_MAP } from './errors';
import type { WalletAdapter } from './types/common';

/**
 * Convert a Keypair to a WalletAdapter compatible with the SDK client.
 * For server-side use (Node.js backends, ElizaOS agents, scripts).
 */
export function keypairToWalletAdapter(keypair: Keypair): WalletAdapter {
  return {
    publicKey: keypair.publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
      if (tx instanceof Transaction) {
        tx.partialSign(keypair);
      }
      return tx;
    },
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => {
      for (const tx of txs) {
        if (tx instanceof Transaction) {
          tx.partialSign(keypair);
        }
      }
      return txs;
    },
  };
}

/**
 * Map between human-readable capability strings and bitmask values.
 */
const CAPABILITY_NAMES: Record<number, string> = {
  [Capability.CodeReview]: 'CodeReview',
  [Capability.SecurityAudit]: 'SecurityAudit',
  [Capability.Documentation]: 'Documentation',
  [Capability.Testing]: 'Testing',
  [Capability.Deployment]: 'Deployment',
  [Capability.General]: 'General',
};

const CAPABILITY_FROM_STRING: Record<string, number> = {};
for (const [val, name] of Object.entries(CAPABILITY_NAMES)) {
  CAPABILITY_FROM_STRING[name.toLowerCase()] = Number(val);
}

/**
 * Convert a capability bitmask to human-readable string array.
 * e.g. 0x03 → ['CodeReview', 'SecurityAudit']
 */
export function capabilitiesToStrings(bitmask: number): string[] {
  const result: string[] = [];
  for (const [val, name] of Object.entries(CAPABILITY_NAMES)) {
    if (bitmask & Number(val)) {
      result.push(name);
    }
  }
  return result;
}

/**
 * Convert human-readable capability strings to bitmask.
 * e.g. ['CodeReview', 'SecurityAudit'] → 0x03
 */
export function stringsToCapabilities(names: string[]): number {
  let bitmask = 0;
  for (const name of names) {
    const val = CAPABILITY_FROM_STRING[name.toLowerCase()];
    if (val !== undefined) {
      bitmask |= val;
    }
  }
  return bitmask;
}

/**
 * Format an Anchor/program error into a human-readable message.
 * Catches both Anchor errors (with errorCode) and raw transaction errors.
 */
export function formatError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as any;

    // Anchor error with code
    if (e.error?.errorCode?.code) {
      return `${e.error.errorCode.code}: ${e.error.errorMessage || e.error.errorCode.code}`;
    }

    // Anchor error with number
    if (e.error?.errorCode?.number) {
      const name = ERROR_MAP[e.error.errorCode.number];
      if (name) return name;
    }

    // Custom program error in logs
    if (e.logs) {
      const logs = e.logs as string[];
      for (const log of logs) {
        const match = log.match(/custom program error: 0x([0-9a-f]+)/i);
        if (match) {
          const code = parseInt(match[1], 16);
          const name = ERROR_MAP[code];
          if (name) return name;
        }
      }
    }

    // Standard Error
    if (e.message) return e.message;
  }

  return String(err);
}

/**
 * Validate a base58 string is a valid Solana public key.
 */
export function isValidPublicKey(value: string): boolean {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert SOL to lamports.
 */
export function solToLamports(sol: number): number {
  return Math.round(sol * 1_000_000_000);
}

/**
 * Convert lamports to SOL.
 */
export function lamportsToSol(lamports: number | bigint): number {
  return Number(lamports) / 1_000_000_000;
}
