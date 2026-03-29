import { PublicKey, TransactionSignature, TransactionInstruction, Signer } from '@solana/web3.js';

export interface TransactionResult {
  signature: TransactionSignature;
  accounts: Record<string, PublicKey>;
}

export interface SendOptions {
  skipPreflight?: boolean;
  commitment?: 'processed' | 'confirmed' | 'finalized';
  maxRetries?: number;
}

export interface WalletAdapter {
  publicKey: PublicKey;
  signTransaction<T extends import('@solana/web3.js').Transaction | import('@solana/web3.js').VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends import('@solana/web3.js').Transaction | import('@solana/web3.js').VersionedTransaction>(txs: T[]): Promise<T[]>;
}

export interface InstructionResult {
  instruction: TransactionInstruction;
  additionalSigners: Signer[];
  accounts: Record<string, PublicKey>;
  setupInstructions: TransactionInstruction[];
}
