/**
 * Full Agent Protocol lifecycle demo.
 *
 * Runs the complete flow: register → hire → complete → pay → rate → close
 * Two wallets: one agent, one client.
 *
 * Usage:
 *   npx tsx examples/03-full-lifecycle.ts
 *
 * Requires a local validator:
 *   solana-test-validator --bpf-program GEtqx8oSqZeuEnMKmXMPCiDsXuQBoVk1q72SyTWxJYUG target/deploy/agent_protocol.so --reset
 */
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  AgentProtocolClient,
  keypairToWalletAdapter,
  Capability,
  solToLamports,
  lamportsToSol,
  capabilitiesToStrings,
} from 'agent-protocol-sdk';

const connection = new Connection('http://127.0.0.1:8899', 'confirmed');

async function airdrop(pubkey: any) {
  const sig = await connection.requestAirdrop(pubkey, 10 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig);
}

async function main() {
  // Setup two wallets
  const agentKp = Keypair.generate();
  const clientKp = Keypair.generate();
  await airdrop(agentKp.publicKey);
  await airdrop(clientKp.publicKey);

  const agentClient = new AgentProtocolClient({ connection, wallet: keypairToWalletAdapter(agentKp) });
  const clientClient = new AgentProtocolClient({ connection, wallet: keypairToWalletAdapter(clientKp) });

  console.log('=== Agent Protocol Full Lifecycle ===\n');
  console.log('Agent:', agentKp.publicKey.toBase58());
  console.log('Client:', clientKp.publicKey.toBase58());

  // 1. Register
  console.log('\n--- 1. Register Agent ---');
  const reg = await agentClient.registerAgent({
    name: 'AuditBot',
    description: 'Smart contract security auditor',
    capabilities: Capability.SecurityAudit | Capability.CodeReview,
    priceLamports: solToLamports(0.5),
  });
  console.log('Registered:', reg.accounts.agentProfile.toBase58());

  // 2. Stake
  console.log('\n--- 2. Stake ---');
  await agentClient.stakeAgent({ amount: solToLamports(1) });
  console.log('Staked 1 SOL');

  // 3. Client hires agent
  console.log('\n--- 3. Hire Agent ---');
  const job = await clientClient.invokeAgent({
    agentOwner: agentKp.publicKey,
    description: 'Audit the DeFi vault contract',
    paymentAmount: solToLamports(2),
    autoReleaseSeconds: 3600,
  });
  console.log('Job created:', job.accounts.job.toBase58());
  console.log('Escrowed: 2 SOL');

  // 4. Agent completes work
  console.log('\n--- 4. Complete Job ---');
  await agentClient.updateJob({
    job: job.accounts.job,
    resultUri: 'https://arweave.net/audit-report-abc123',
  });
  console.log('Work submitted');

  // 5. Client releases payment
  console.log('\n--- 5. Release Payment ---');
  const balBefore = await connection.getBalance(agentKp.publicKey);
  await clientClient.releasePayment({ job: job.accounts.job });
  const balAfter = await connection.getBalance(agentKp.publicKey);
  console.log('Payment released! Agent received', lamportsToSol(balAfter - balBefore).toFixed(2), 'SOL');

  // 6. Client rates agent
  console.log('\n--- 6. Rate Agent ---');
  await clientClient.rateAgent({ job: job.accounts.job, score: 5 });
  console.log('Rated 5/5');

  // 7. Close job (reclaim rent)
  console.log('\n--- 7. Close Job ---');
  await clientClient.closeJob({ job: job.accounts.job });
  console.log('Job closed, rent reclaimed');

  // 8. Final agent profile
  console.log('\n--- Final Profile ---');
  const agent = await agentClient.fetchAgent(agentKp.publicKey);
  console.log('Name:', agent.name);
  console.log('Jobs completed:', agent.jobsCompleted);
  console.log('Rating:', (Number(agent.ratingSum) / agent.ratingCount).toFixed(1), '/ 5');
  console.log('Capabilities:', capabilitiesToStrings(agent.capabilities).join(', '));
  console.log('Stake:', lamportsToSol(Number(agent.stakeAmount)), 'SOL');

  console.log('\n=== Done! ===');
}

main().catch(console.error);
