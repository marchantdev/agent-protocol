import { PublicKey } from '@solana/web3.js';
import { formatError, isValidPublicKey, solToLamports, lamportsToSol } from 'agent-protocol-sdk';
import { getClient } from '../client.js';

function extractJobPDA(text: string, callback?: (r: any) => void): PublicKey | null {
  const match = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
  if (!match || !isValidPublicKey(match[0])) {
    callback?.({ text: 'Please provide the job address (Solana public key).' });
    return null;
  }
  return new PublicKey(match[0]);
}

export const rejectJobAction = {
  name: 'REJECT_JOB',
  similes: ['DECLINE_JOB', 'REFUSE_JOB', 'TURN_DOWN_JOB'],
  description: 'Reject a pending job on Agent Protocol. Returns escrowed funds to the client. Only the assigned agent can reject.',

  examples: [
    [
      { user: '{{user1}}', content: { text: 'Reject job 4pK1...' } },
      { user: '{{agentName}}', content: { text: 'I\'ll reject the job and refund the client.', action: 'REJECT_JOB' } },
    ],
  ],

  validate: async (runtime: any): Promise<boolean> => !!runtime.getSetting('SOLANA_PRIVATE_KEY'),

  handler: async (runtime: any, message: any, _s?: any, _o?: any, callback?: (r: any) => void): Promise<boolean> => {
    try {
      const jobPDA = extractJobPDA(message.content?.text || '', callback);
      if (!jobPDA) return false;
      const result = await getClient(runtime).rejectJob({ job: jobPDA });
      callback?.({ text: `Job rejected, client refunded. Transaction: ${result.signature}` });
      return true;
    } catch (err) {
      callback?.({ text: `Failed to reject job: ${formatError(err)}` });
      return false;
    }
  },
};

export const cancelJobAction = {
  name: 'CANCEL_JOB',
  similes: ['CANCEL', 'ABORT_JOB', 'WITHDRAW_JOB'],
  description: 'Cancel a pending job on Agent Protocol. Returns escrowed funds. Only the client who created the job can cancel.',

  examples: [
    [
      { user: '{{user1}}', content: { text: 'Cancel job 4pK1...' } },
      { user: '{{agentName}}', content: { text: 'I\'ll cancel the job and return your funds.', action: 'CANCEL_JOB' } },
    ],
  ],

  validate: async (runtime: any): Promise<boolean> => !!runtime.getSetting('SOLANA_PRIVATE_KEY'),

  handler: async (runtime: any, message: any, _s?: any, _o?: any, callback?: (r: any) => void): Promise<boolean> => {
    try {
      const jobPDA = extractJobPDA(message.content?.text || '', callback);
      if (!jobPDA) return false;
      const result = await getClient(runtime).cancelJob({ job: jobPDA });
      callback?.({ text: `Job cancelled, escrow refunded. Transaction: ${result.signature}` });
      return true;
    } catch (err) {
      callback?.({ text: `Failed to cancel job: ${formatError(err)}` });
      return false;
    }
  },
};

export const raiseDisputeAction = {
  name: 'RAISE_DISPUTE',
  similes: ['DISPUTE_JOB', 'DISPUTE', 'CHALLENGE_JOB'],
  description: 'Raise a dispute on a job. Freezes the escrow. Either client or agent can dispute. Completed jobs require an arbiter.',

  examples: [
    [
      { user: '{{user1}}', content: { text: 'Dispute job 4pK1...' } },
      { user: '{{agentName}}', content: { text: 'I\'ll raise a dispute on that job.', action: 'RAISE_DISPUTE' } },
    ],
  ],

  validate: async (runtime: any): Promise<boolean> => !!runtime.getSetting('SOLANA_PRIVATE_KEY'),

  handler: async (runtime: any, message: any, _s?: any, _o?: any, callback?: (r: any) => void): Promise<boolean> => {
    try {
      const jobPDA = extractJobPDA(message.content?.text || '', callback);
      if (!jobPDA) return false;
      const result = await getClient(runtime).raiseDispute({ job: jobPDA });
      callback?.({ text: `Dispute raised. Escrow is frozen. Transaction: ${result.signature}` });
      return true;
    } catch (err) {
      callback?.({ text: `Failed to raise dispute: ${formatError(err)}` });
      return false;
    }
  },
};

export const rateAgentAction = {
  name: 'RATE_AGENT',
  similes: ['RATE', 'REVIEW_AGENT', 'SCORE_AGENT'],
  description: 'Rate an agent 1-5 after payment is released. Only the client can rate.',

  examples: [
    [
      { user: '{{user1}}', content: { text: 'Rate job 4pK1... 5 stars' } },
      { user: '{{agentName}}', content: { text: 'I\'ll rate the agent 5/5.', action: 'RATE_AGENT' } },
    ],
  ],

  validate: async (runtime: any): Promise<boolean> => !!runtime.getSetting('SOLANA_PRIVATE_KEY'),

  handler: async (runtime: any, message: any, _s?: any, _o?: any, callback?: (r: any) => void): Promise<boolean> => {
    try {
      const text = message.content?.text || '';
      const jobPDA = extractJobPDA(text, callback);
      if (!jobPDA) return false;

      const scoreMatch = text.match(/([1-5])\s*(?:star|\/5|out of)/i) || text.match(/\b([1-5])\b/);
      if (!scoreMatch) { callback?.({ text: 'Please provide a rating from 1-5.' }); return false; }

      const score = parseInt(scoreMatch[1]) as 1 | 2 | 3 | 4 | 5;
      const result = await getClient(runtime).rateAgent({ job: jobPDA, score });
      callback?.({ text: `Rated agent ${score}/5. Transaction: ${result.signature}` });
      return true;
    } catch (err) {
      callback?.({ text: `Failed to rate: ${formatError(err)}` });
      return false;
    }
  },
};

export const delegateTaskAction = {
  name: 'DELEGATE_TASK',
  similes: ['DELEGATE', 'SUBCONTRACT', 'HIRE_SUB_AGENT', 'SPLIT_TASK'],
  description: 'Delegate a subtask from your current job to another agent. Splits escrow from the parent job.',

  examples: [
    [
      { user: '{{user1}}', content: { text: 'Delegate from job 4pK1... to agent 7RRi... for 0.5 SOL: run static analysis' } },
      { user: '{{agentName}}', content: { text: 'I\'ll delegate the static analysis subtask.', action: 'DELEGATE_TASK' } },
    ],
  ],

  validate: async (runtime: any): Promise<boolean> => !!runtime.getSetting('SOLANA_PRIVATE_KEY'),

  handler: async (runtime: any, message: any, _s?: any, _o?: any, callback?: (r: any) => void): Promise<boolean> => {
    try {
      const client = getClient(runtime);
      const text = message.content?.text || '';

      // Need two pubkeys: parent job and sub-agent
      const pubkeys = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
      if (!pubkeys || pubkeys.length < 2) {
        callback?.({ text: 'Please provide the parent job address and sub-agent wallet address.' });
        return false;
      }

      const solMatch = text.match(/(\d+(?:\.\d+)?)\s*SOL/i);
      if (!solMatch) { callback?.({ text: 'Please specify delegation amount in SOL.' }); return false; }

      // Extract description
      let desc = text.replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/g, '').replace(solMatch[0], '').replace(/delegate|from|to|for|job|agent/gi, '').trim();
      if (!desc || desc.length < 3) desc = 'Delegated subtask';

      const result = await client.delegateTask({
        parentJob: new PublicKey(pubkeys[0]),
        subAgentOwner: new PublicKey(pubkeys[1]),
        description: desc.slice(0, 256),
        delegationAmount: solToLamports(parseFloat(solMatch[1])),
      });

      callback?.({
        text: `Delegated!\n- Child job: ${result.accounts.childJob.toBase58()}\n- Amount: ${solMatch[1]} SOL\n- Transaction: ${result.signature}`,
      });
      return true;
    } catch (err) {
      callback?.({ text: `Failed to delegate: ${formatError(err)}` });
      return false;
    }
  },
};

export const closeJobAction = {
  name: 'CLOSE_JOB',
  similes: ['CLOSE', 'RECLAIM_RENT', 'CLEANUP_JOB'],
  description: 'Close a finalized or cancelled job account to reclaim rent SOL.',

  examples: [
    [
      { user: '{{user1}}', content: { text: 'Close job 4pK1...' } },
      { user: '{{agentName}}', content: { text: 'I\'ll close the job and reclaim the rent.', action: 'CLOSE_JOB' } },
    ],
  ],

  validate: async (runtime: any): Promise<boolean> => !!runtime.getSetting('SOLANA_PRIVATE_KEY'),

  handler: async (runtime: any, message: any, _s?: any, _o?: any, callback?: (r: any) => void): Promise<boolean> => {
    try {
      const jobPDA = extractJobPDA(message.content?.text || '', callback);
      if (!jobPDA) return false;
      const result = await getClient(runtime).closeJob({ job: jobPDA });
      callback?.({ text: `Job closed, rent reclaimed. Transaction: ${result.signature}` });
      return true;
    } catch (err) {
      callback?.({ text: `Failed to close job: ${formatError(err)}` });
      return false;
    }
  },
};
