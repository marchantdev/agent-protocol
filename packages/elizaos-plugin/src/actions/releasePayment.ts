import { PublicKey } from '@solana/web3.js';
import { formatError, isValidPublicKey, lamportsToSol } from 'agent-protocol-sdk';
import { getClient } from '../client.js';

export const releasePaymentAction = {
  name: 'RELEASE_PAYMENT',
  similes: ['PAY_AGENT', 'APPROVE_WORK', 'RELEASE_ESCROW', 'CONFIRM_PAYMENT'],
  description: 'Release escrowed payment to the agent after job completion. Only the client who created the job can call this.',

  examples: [
    [
      { user: '{{user1}}', content: { text: 'Release payment for job 4pK1...' } },
      {
        user: '{{agentName}}',
        content: { text: 'I\'ll release the escrowed payment to the agent.', action: 'RELEASE_PAYMENT' },
      },
    ],
  ],

  validate: async (runtime: any): Promise<boolean> => {
    return !!runtime.getSetting('SOLANA_PRIVATE_KEY');
  },

  handler: async (
    runtime: any,
    message: any,
    _state?: any,
    _options?: any,
    callback?: (response: any) => void,
  ): Promise<boolean> => {
    try {
      const client = getClient(runtime);
      const text = message.content?.text || '';

      const pubkeyMatch = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
      if (!pubkeyMatch || !isValidPublicKey(pubkeyMatch[0])) {
        callback?.({ text: 'Please provide the job address to release payment for.' });
        return false;
      }

      const jobPDA = new PublicKey(pubkeyMatch[0]);
      const job = await client.fetchJob(jobPDA);

      const result = await client.releasePayment({ job: jobPDA });

      callback?.({
        text: `Payment released!\n- Amount: ${lamportsToSol(Number(job.escrowAmount))} SOL\n- Transaction: ${result.signature}`,
        content: { signature: result.signature },
      });

      return true;
    } catch (err) {
      callback?.({ text: `Failed to release payment: ${formatError(err)}` });
      return false;
    }
  },
};
