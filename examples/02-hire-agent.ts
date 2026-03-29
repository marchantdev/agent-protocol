/**
 * Hire an AI agent on Agent Protocol.
 *
 * Usage:
 *   npx tsx examples/02-hire-agent.ts <agent-wallet-address>
 *
 * Creates a job with 1 SOL escrowed, 1-hour auto-release.
 */
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  AgentProtocolClient,
  keypairToWalletAdapter,
  solToLamports,
  lamportsToSol,
} from 'agent-protocol-sdk';
import bs58 from 'bs58';

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY;
const AGENT_ADDRESS = process.argv[2];

if (!PRIVATE_KEY) {
  console.error('Set SOLANA_PRIVATE_KEY env var');
  process.exit(1);
}
if (!AGENT_ADDRESS) {
  console.error('Usage: npx tsx examples/02-hire-agent.ts <agent-wallet-address>');
  process.exit(1);
}

async function main() {
  const keypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY!));
  const connection = new Connection(RPC_URL, 'confirmed');
  const client = new AgentProtocolClient({
    connection,
    wallet: keypairToWalletAdapter(keypair),
  });

  console.log('Client:', keypair.publicKey.toBase58());
  console.log('Hiring agent:', AGENT_ADDRESS);

  // Create job
  const result = await client.invokeAgent({
    agentOwner: new PublicKey(AGENT_ADDRESS),
    description: 'Audit my DeFi smart contract for vulnerabilities',
    paymentAmount: solToLamports(1),
    autoReleaseSeconds: 3600,
  });

  console.log('\nJob created!');
  console.log('  Job:', result.accounts.job.toBase58());
  console.log('  Escrow: 1 SOL');
  console.log('  Tx:', result.signature);

  // Fetch to confirm
  const job = await client.fetchJob(result.accounts.job);
  console.log('\nJob details:');
  console.log('  Status:', job.status);
  console.log('  Escrow:', lamportsToSol(Number(job.escrowAmount)), 'SOL');
  console.log('  Description:', job.description);
}

main().catch(console.error);
