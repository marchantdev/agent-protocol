import { PublicKey, TransactionInstruction, Connection } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

export async function ensureATA(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
  payer: PublicKey,
  allowOwnerOffCurve: boolean = false,
): Promise<{ ata: PublicKey; setupIx: TransactionInstruction | null }> {
  const ata = getAssociatedTokenAddressSync(mint, owner, allowOwnerOffCurve);
  const info = await connection.getAccountInfo(ata);
  if (info) {
    return { ata, setupIx: null };
  }
  const setupIx = createAssociatedTokenAccountInstruction(payer, ata, owner, mint);
  return { ata, setupIx };
}

export function buildRemainingAccounts(
  accounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[],
) {
  return accounts;
}

export async function buildInvokeAgentSplAccounts(
  connection: Connection,
  mint: PublicKey,
  clientPubkey: PublicKey,
  jobPDA: PublicKey,
  payer: PublicKey,
) {
  const setupInstructions: TransactionInstruction[] = [];

  const { ata: clientToken, setupIx: clientSetupIx } = await ensureATA(
    connection, mint, clientPubkey, payer, false,
  );
  if (clientSetupIx) setupInstructions.push(clientSetupIx);

  const { ata: escrowVault, setupIx: escrowSetupIx } = await ensureATA(
    connection, mint, jobPDA, payer, true,
  );
  if (escrowSetupIx) setupInstructions.push(escrowSetupIx);

  return {
    remainingAccounts: [
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: clientToken, isSigner: false, isWritable: true },
      { pubkey: escrowVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    setupInstructions,
  };
}

export async function buildReleaseSplAccounts(
  connection: Connection,
  mint: PublicKey,
  escrowVault: PublicKey,
  agentPubkey: PublicKey,
  payer: PublicKey,
) {
  const setupInstructions: TransactionInstruction[] = [];

  const { ata: agentToken, setupIx } = await ensureATA(
    connection, mint, agentPubkey, payer, false,
  );
  if (setupIx) setupInstructions.push(setupIx);

  return {
    remainingAccounts: [
      { pubkey: escrowVault, isSigner: false, isWritable: true },
      { pubkey: agentToken, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    setupInstructions,
  };
}

export async function buildRefundSplAccounts(
  connection: Connection,
  mint: PublicKey,
  escrowVault: PublicKey,
  clientPubkey: PublicKey,
  agentProfilePDA: PublicKey,
  payer: PublicKey,
) {
  const setupInstructions: TransactionInstruction[] = [];

  const { ata: clientToken, setupIx } = await ensureATA(
    connection, mint, clientPubkey, payer, false,
  );
  if (setupIx) setupInstructions.push(setupIx);

  return {
    remainingAccounts: [
      { pubkey: escrowVault, isSigner: false, isWritable: true },
      { pubkey: clientToken, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: agentProfilePDA, isSigner: false, isWritable: false },
    ],
    setupInstructions,
  };
}

export async function buildDelegateSplAccounts(
  connection: Connection,
  mint: PublicKey,
  parentEscrowVault: PublicKey,
  childJobPDA: PublicKey,
  parentAgentProfilePDA: PublicKey,
  payer: PublicKey,
) {
  const setupInstructions: TransactionInstruction[] = [];

  const { ata: childVault, setupIx } = await ensureATA(
    connection, mint, childJobPDA, payer, true,
  );
  if (setupIx) setupInstructions.push(setupIx);

  return {
    remainingAccounts: [
      { pubkey: parentEscrowVault, isSigner: false, isWritable: true },
      { pubkey: childVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: parentAgentProfilePDA, isSigner: false, isWritable: false },
    ],
    setupInstructions,
  };
}
