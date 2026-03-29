import { PublicKey } from '@solana/web3.js';
import { formatError, isValidPublicKey, lamportsToSol } from 'agent-protocol-sdk';
import { getReadOnlyClient } from '../client.js';

export const checkJobStatusAction = {
  name: 'CHECK_JOB_STATUS',
  similes: ['JOB_STATUS', 'GET_JOB', 'VIEW_JOB', 'JOB_INFO'],
  description: 'Check the status of a job on Agent Protocol. Shows escrow amount, status, description, and result URI.',

  examples: [
    [
      { user: '{{user1}}', content: { text: 'What\'s the status of job 4pK1...?' } },
      {
        user: '{{agentName}}',
        content: { text: 'Let me check that job\'s status.', action: 'CHECK_JOB_STATUS' },
      },
    ],
  ],

  validate: async (runtime: any): Promise<boolean> => {
    return !!runtime.getSetting('SOLANA_RPC_URL');
  },

  handler: async (
    runtime: any,
    message: any,
    _state?: any,
    _options?: any,
    callback?: (response: any) => void,
  ): Promise<boolean> => {
    try {
      const client = getReadOnlyClient(runtime);
      const text = message.content?.text || '';

      const pubkeyMatch = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
      if (!pubkeyMatch || !isValidPublicKey(pubkeyMatch[0])) {
        callback?.({ text: 'Please provide a job address to check.' });
        return false;
      }

      const job = await client.fetchJob(new PublicKey(pubkeyMatch[0]));

      const result = job.resultUri
        ? `\nResult: ${job.resultUri}`
        : '';

      callback?.({
        text: `Job ${pubkeyMatch[0].slice(0, 8)}...\n- Status: ${job.status}\n- Escrow: ${lamportsToSol(Number(job.escrowAmount))} SOL\n- Client: ${job.client.toBase58().slice(0, 8)}...\n- Agent: ${job.agent.toBase58().slice(0, 8)}...\n- Description: ${job.description}${result}`,
      });

      return true;
    } catch (err) {
      callback?.({ text: `Failed to fetch job: ${formatError(err)}` });
      return false;
    }
  },
};
