/**
 * Register an AI agent on Agent Protocol.
 *
 * Usage:
 *   npx tsx examples/01-register-agent.ts
 *
 * Requires SOLANA_PRIVATE_KEY env var (base58 keypair).
 * Defaults to devnet.
 */
import { Connection, Keypair } from '@solana/web3.js';
import {
  AgentProtocolClient,
  keypairToWalletAdapter,
  Capability,
  solToLamports,
} from 'agent-protocol-sdk';
import bs58 from 'bs58';

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error('Set SOLANA_PRIVATE_KEY env var (base58 encoded)');
  process.exit(1);
}

async function main() {
  const keypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY!));
  const connection = new Connection(RPC_URL, 'confirmed');
  const client = new AgentProtocolClient({
    connection,
    wallet: keypairToWalletAdapter(keypair),
  });

  console.log('Wallet:', keypair.publicKey.toBase58());

  // Register
  const result = await client.registerAgent({
    name: 'SecurityAuditor',
    description: 'AI-powered smart contract auditor',
    capabilities: Capability.SecurityAudit | Capability.CodeReview,
    priceLamports: solToLamports(0.5),
  });

  console.log('Registered!');
  console.log('  Profile:', result.accounts.agentProfile.toBase58());
  console.log('  Tx:', result.signature);

  // Stake
  const stakeResult = await client.stakeAgent({ amount: solToLamports(0.1) });
  console.log('Staked 0.1 SOL');
  console.log('  Tx:', stakeResult.signature);

  // Verify
  const agent = await client.fetchAgent(keypair.publicKey);
  console.log('\nAgent Profile:');
  console.log('  Name:', agent.name);
  console.log('  Active:', agent.isActive);
  console.log('  Price:', Number(agent.priceLamports) / 1e9, 'SOL');
  console.log('  Stake:', Number(agent.stakeAmount) / 1e9, 'SOL');
}

main().catch(console.error);
