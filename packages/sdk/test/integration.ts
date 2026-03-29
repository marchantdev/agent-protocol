import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import {
  AgentProtocolClient,
  getAgentProfilePDA,
  getJobPDA,
  getRatingPDA,
  getStakeVaultPDA,
  JobStatus,
  Capability,
  PROGRAM_ID,
  MIN_STAKE_LAMPORTS,
} from '../src';

const connection = new Connection('http://127.0.0.1:8899', 'confirmed');

async function airdrop(pubkey: PublicKey, amount = 10 * LAMPORTS_PER_SOL) {
  const sig = await connection.requestAirdrop(pubkey, amount);
  await connection.confirmTransaction(sig);
}

function makeWallet(kp: Keypair) {
  return {
    publicKey: kp.publicKey,
    signTransaction: async <T>(tx: T): Promise<T> => {
      (tx as any).partialSign(kp);
      return tx;
    },
    signAllTransactions: async <T>(txs: T[]): Promise<T[]> => {
      txs.forEach((tx: any) => tx.partialSign(kp));
      return txs;
    },
  };
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗ ${msg}`);
    failed++;
  }
}

async function assertThrows(fn: () => Promise<any>, msg: string) {
  try {
    await fn();
    console.log(`  ✗ ${msg} (did not throw)`);
    failed++;
  } catch {
    console.log(`  ✓ ${msg}`);
    passed++;
  }
}

async function main() {
  console.log('\n=== Agent Protocol SDK Integration Tests ===\n');
  console.log(`Program ID: ${PROGRAM_ID.toBase58()}`);

  // --- Setup ---
  const agentOwner = Keypair.generate();
  const clientKp = Keypair.generate();
  const arbiterKp = Keypair.generate();
  await airdrop(agentOwner.publicKey);
  await airdrop(clientKp.publicKey);
  await airdrop(arbiterKp.publicKey);

  const agentClient = new AgentProtocolClient({ connection, wallet: makeWallet(agentOwner) });
  const clientClient = new AgentProtocolClient({ connection, wallet: makeWallet(clientKp) });
  const arbiterClient = new AgentProtocolClient({ connection, wallet: makeWallet(arbiterKp) });

  // --- 1. PDA derivation ---
  console.log('\n1. PDA Derivation');
  const [profilePDA] = getAgentProfilePDA(agentOwner.publicKey);
  assert(profilePDA instanceof PublicKey, 'getAgentProfilePDA returns PublicKey');
  const [stakeVaultPDA] = getStakeVaultPDA(profilePDA);
  assert(stakeVaultPDA instanceof PublicKey, 'getStakeVaultPDA returns PublicKey');

  // --- 2. Register Agent ---
  console.log('\n2. Register Agent');
  const regResult = await agentClient.registerAgent({
    name: 'TestAgent',
    description: 'An SDK test agent',
    capabilities: Capability.CodeReview | Capability.General,
    priceLamports: LAMPORTS_PER_SOL / 2,
  });
  assert(!!regResult.signature, 'registerAgent returns signature');
  assert(regResult.accounts.agentProfile.equals(profilePDA), 'registerAgent returns correct PDA');

  // --- 3. Fetch Agent ---
  console.log('\n3. Fetch Agent');
  const agent = await agentClient.fetchAgent(agentOwner.publicKey);
  assert(agent.name === 'TestAgent', 'fetchAgent returns correct name');
  assert(agent.isActive === true, 'fetchAgent returns active');
  assert(agent.priceLamports.eq(new BN(LAMPORTS_PER_SOL / 2)), 'fetchAgent returns correct price');
  assert(agent.jobNonce.eq(new BN(0)), 'fetchAgent returns nonce 0');
  assert(agent.capabilities === (Capability.CodeReview | Capability.General), 'fetchAgent returns correct capabilities');

  // --- 4. Update Agent ---
  console.log('\n4. Update Agent');
  await agentClient.updateAgent({ name: 'UpdatedAgent', priceLamports: LAMPORTS_PER_SOL });
  const updated = await agentClient.fetchAgent(agentOwner.publicKey);
  assert(updated.name === 'UpdatedAgent', 'updateAgent updates name');
  assert(updated.priceLamports.eq(new BN(LAMPORTS_PER_SOL)), 'updateAgent updates price');

  // --- 5. Stake Agent ---
  console.log('\n5. Stake Agent');
  const stakeResult = await agentClient.stakeAgent({ amount: MIN_STAKE_LAMPORTS });
  assert(!!stakeResult.signature, 'stakeAgent returns signature');
  const vault = await agentClient.fetchStakeVault(profilePDA);
  assert(vault.amount.eq(new BN(MIN_STAKE_LAMPORTS)), 'stakeVault has correct amount');

  // --- 6. Invoke Agent (create job) ---
  console.log('\n6. Invoke Agent');
  const invokeResult = await clientClient.invokeAgent({
    agentOwner: agentOwner.publicKey,
    description: 'Audit my smart contract',
    paymentAmount: LAMPORTS_PER_SOL,
    autoReleaseSeconds: 3600,
  });
  assert(!!invokeResult.signature, 'invokeAgent returns signature');
  assert(!!invokeResult.accounts.job, 'invokeAgent returns job PDA');
  const jobPDA = invokeResult.accounts.job;

  // --- 7. Fetch Job ---
  console.log('\n7. Fetch Job');
  const job = await clientClient.fetchJob(jobPDA);
  assert(job.client.equals(clientKp.publicKey), 'fetchJob returns correct client');
  assert(job.agent.equals(agentOwner.publicKey), 'fetchJob returns correct agent');
  assert(job.status === JobStatus.Pending, 'fetchJob returns Pending status');
  assert(job.escrowAmount.eq(new BN(LAMPORTS_PER_SOL)), 'fetchJob returns correct escrow');
  assert(job.description === 'Audit my smart contract', 'fetchJob returns correct description');
  assert(job.autoReleaseAt !== null, 'fetchJob has autoReleaseAt set');

  // --- 8. Self-invoke prevention ---
  console.log('\n8. Self-invoke Prevention');
  await assertThrows(
    () => agentClient.invokeAgent({
      agentOwner: agentOwner.publicKey,
      description: 'Self invoke',
      paymentAmount: LAMPORTS_PER_SOL,
    }),
    'self-invoke blocked',
  );

  // --- 9. Update Job (agent completes) ---
  console.log('\n9. Update Job');
  await agentClient.updateJob({ job: jobPDA, resultUri: 'https://results.example.com/audit' });
  const completed = await clientClient.fetchJob(jobPDA);
  assert(completed.status === JobStatus.Completed, 'updateJob sets Completed');
  assert(completed.resultUri === 'https://results.example.com/audit', 'updateJob sets resultUri');

  // --- 10. Release Payment ---
  console.log('\n10. Release Payment');
  const agentBalBefore = await connection.getBalance(agentOwner.publicKey);
  await clientClient.releasePayment({ job: jobPDA });
  const agentBalAfter = await connection.getBalance(agentOwner.publicKey);
  assert(agentBalAfter > agentBalBefore, 'agent received payment');
  const finalized = await clientClient.fetchJob(jobPDA);
  assert(finalized.status === JobStatus.Finalized, 'releasePayment sets Finalized');

  // --- 11. Rate Agent ---
  console.log('\n11. Rate Agent');
  await clientClient.rateAgent({ job: jobPDA, score: 5 });
  const rated = await clientClient.fetchAgent(agentOwner.publicKey);
  assert(rated.ratingCount === 1, 'rateAgent increments count');
  assert(rated.ratingSum.eq(new BN(5)), 'rateAgent sets sum');
  assert(rated.jobsCompleted === 1, 'agent has 1 job completed');

  // --- 12. Close Job ---
  console.log('\n12. Close Job');
  await clientClient.closeJob({ job: jobPDA });
  await assertThrows(
    () => clientClient.fetchJob(jobPDA),
    'closed job cannot be fetched',
  );

  // --- 13. Invoke + Cancel ---
  console.log('\n13. Cancel Job');
  const cancelResult = await clientClient.invokeAgent({
    agentOwner: agentOwner.publicKey,
    description: 'Job to cancel',
    paymentAmount: LAMPORTS_PER_SOL,
  });
  await clientClient.cancelJob({ job: cancelResult.accounts.job });
  await assertThrows(
    () => clientClient.fetchJob(cancelResult.accounts.job),
    'cancelled job closed',
  );

  // --- 14. Invoke + Reject ---
  console.log('\n14. Reject Job');
  const rejectResult = await clientClient.invokeAgent({
    agentOwner: agentOwner.publicKey,
    description: 'Job to reject',
    paymentAmount: LAMPORTS_PER_SOL,
  });
  await agentClient.rejectJob({ job: rejectResult.accounts.job });
  await assertThrows(
    () => clientClient.fetchJob(rejectResult.accounts.job),
    'rejected job closed',
  );

  // --- 15. Dispute (Pending, no arbiter) + Timeout ---
  console.log('\n15. Dispute on Pending Job');
  const disputeResult = await clientClient.invokeAgent({
    agentOwner: agentOwner.publicKey,
    description: 'Job to dispute',
    paymentAmount: LAMPORTS_PER_SOL,
  });
  await clientClient.raiseDispute({ job: disputeResult.accounts.job });
  const disputed = await clientClient.fetchJob(disputeResult.accounts.job);
  assert(disputed.status === JobStatus.Disputed, 'raiseDispute sets Disputed');

  // --- 16. Completed dispute without arbiter fails ---
  console.log('\n16. Completed Dispute Requires Arbiter');
  const noArbiterJob = await clientClient.invokeAgent({
    agentOwner: agentOwner.publicKey,
    description: 'Complete without arbiter',
    paymentAmount: LAMPORTS_PER_SOL,
  });
  await agentClient.updateJob({ job: noArbiterJob.accounts.job, resultUri: 'https://done.com' });
  await assertThrows(
    () => clientClient.raiseDispute({ job: noArbiterJob.accounts.job }),
    'dispute on completed job without arbiter blocked',
  );
  // Clean up
  await clientClient.releasePayment({ job: noArbiterJob.accounts.job });

  // --- 17. Delegation ---
  console.log('\n17. Delegation');
  const subAgent = Keypair.generate();
  await airdrop(subAgent.publicKey);
  const subClient = new AgentProtocolClient({ connection, wallet: makeWallet(subAgent) });
  await subClient.registerAgent({
    name: 'SubAgent',
    description: 'A sub-agent',
    capabilities: Capability.Testing,
    priceLamports: LAMPORTS_PER_SOL / 4,
  });

  const parentInvoke = await clientClient.invokeAgent({
    agentOwner: agentOwner.publicKey,
    description: 'Parent task',
    paymentAmount: 2 * LAMPORTS_PER_SOL,
  });
  const parentJobPDA = parentInvoke.accounts.job;

  const delegateResult = await agentClient.delegateTask({
    parentJob: parentJobPDA,
    subAgentOwner: subAgent.publicKey,
    description: 'Sub task',
    delegationAmount: LAMPORTS_PER_SOL / 2,
  });
  assert(!!delegateResult.accounts.childJob, 'delegateTask returns child job PDA');

  const childJob = await clientClient.fetchJob(delegateResult.accounts.childJob);
  assert(childJob.parentJob?.equals(parentJobPDA) === true, 'child job references parent');
  assert(childJob.agent.equals(subAgent.publicKey), 'child job assigned to sub-agent');

  // Sub-agent completes child
  await subClient.updateJob({ job: delegateResult.accounts.childJob, resultUri: 'https://sub-result.com' });
  // Agent (delegator) releases child payment
  await agentClient.releasePayment({ job: delegateResult.accounts.childJob });

  // Now agent can complete parent (no more active children)
  await agentClient.updateJob({ job: parentJobPDA, resultUri: 'https://parent-result.com' });
  await clientClient.releasePayment({ job: parentJobPDA });
  const parentFinal = await clientClient.fetchJob(parentJobPDA);
  assert(parentFinal.status === JobStatus.Finalized, 'parent job finalized after delegation chain');

  // --- 18. Unstake ---
  console.log('\n18. Unstake Agent');
  await agentClient.unstakeAgent({ amount: MIN_STAKE_LAMPORTS });
  const agentAfterUnstake = await agentClient.fetchAgent(agentOwner.publicKey);
  assert(agentAfterUnstake.stakeAmount.eq(new BN(0)), 'unstake zeroes stake');

  // --- 19. Fetch All ---
  console.log('\n19. Fetch All');
  const allAgents = await clientClient.fetchAllAgents();
  assert(allAgents.length >= 2, 'fetchAllAgents returns agents');
  const activeAgents = await clientClient.fetchAllAgents({ isActive: true });
  assert(activeAgents.every(a => a.isActive), 'filter by active works');

  // --- 20. Event types exist ---
  console.log('\n20. Event Types');
  const sub = agentClient.onEvent('AgentRegistered', (event) => {
    // Just verify callback type works
  });
  sub.stop();
  assert(true, 'onEvent/stop lifecycle works');

  // --- Results ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
