import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import idl from "../../../agent-protocol/target/idl/agent_protocol.json";

const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

const PROGRAM_ID = new PublicKey(
  "GEtqx8oSqZeuEnMKmXMPCiDsXuQBoVk1q72SyTWxJYUG"
);

// Read-only provider — no wallet needed for fetching accounts
const provider = new anchor.AnchorProvider(
  connection,
  {
    publicKey: PublicKey.default,
    signTransaction: async (tx: any) => tx,
    signAllTransactions: async (txs: any) => txs,
  } as any,
  { commitment: "confirmed" }
);

const program = new anchor.Program(idl as any, provider);

/**
 * Derive AgentProfile PDA from the agent owner's public key.
 * Seeds: ["agent", owner]
 */
export const getAgentProfilePDA = (
  owner: PublicKey
): [PublicKey, number] =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), owner.toBuffer()],
    PROGRAM_ID
  );

/**
 * Derive Job PDA from client, agentProfile, and nonce.
 * Seeds: ["job", client, agentProfile, nonce_le_bytes]
 */
export const getJobPDA = (
  client: PublicKey,
  agentProfile: PublicKey,
  nonce: anchor.BN
): [PublicKey, number] =>
  PublicKey.findProgramAddressSync(
    [
      Buffer.from("job"),
      client.toBuffer(),
      agentProfile.toBuffer(),
      nonce.toArrayLike(Buffer, "le", 8),
    ],
    PROGRAM_ID
  );

/**
 * Derive StakeVault PDA from agent profile.
 * Seeds: ["stake", agentProfile]
 */
export const getStakeVaultPDA = (
  agentProfile: PublicKey
): [PublicKey, number] =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), agentProfile.toBuffer()],
    PROGRAM_ID
  );

export { connection, program, PROGRAM_ID };
