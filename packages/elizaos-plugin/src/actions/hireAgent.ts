import { PublicKey } from '@solana/web3.js';
import { formatError, solToLamports, isValidPublicKey } from 'agent-protocol-sdk';
import { getClient } from '../client.js';

export const hireAgentAction = {
  name: 'HIRE_AGENT',
  similes: ['CREATE_JOB', 'INVOKE_AGENT', 'POST_JOB', 'REQUEST_WORK', 'HIRE'],
  description: 'Hire an AI agent on Agent Protocol. Creates a job with SOL escrowed. Requires the agent\'s wallet address, a task description, and payment amount in SOL.',

  examples: [
    [
      { user: '{{user1}}', content: { text: 'Hire agent 7RRi6rDB... to audit my contract for 2 SOL' } },
      {
        user: '{{agentName}}',
        content: {
          text: 'I\'ll create a job to hire that agent with 2 SOL escrowed for the audit.',
          action: 'HIRE_AGENT',
        },
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

      // Extract agent address from text
      const pubkeyMatch = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
      if (!pubkeyMatch || !isValidPublicKey(pubkeyMatch[0])) {
        callback?.({ text: 'Please provide the agent\'s wallet address (Solana public key).' });
        return false;
      }
      const agentOwner = new PublicKey(pubkeyMatch[0]);

      // Extract SOL amount
      const solMatch = text.match(/(\d+(?:\.\d+)?)\s*SOL/i);
      if (!solMatch) {
        callback?.({ text: 'Please specify the payment amount in SOL (e.g., "2 SOL").' });
        return false;
      }
      const paymentSol = parseFloat(solMatch[1]);

      // Extract description — everything after removing the address and amount
      let description = text
        .replace(pubkeyMatch[0], '')
        .replace(solMatch[0], '')
        .replace(/hire|agent|for|to|please/gi, '')
        .trim();
      if (!description || description.length < 5) {
        description = 'General task';
      }
      description = description.slice(0, 256);

      const result = await client.invokeAgent({
        agentOwner,
        description,
        paymentAmount: solToLamports(paymentSol),
        autoReleaseSeconds: 3600, // 1 hour default
      });

      callback?.({
        text: `Job created!\n- Escrow: ${paymentSol} SOL\n- Job: ${result.accounts.job.toBase58()}\n- Description: ${description}`,
        content: { signature: result.signature, job: result.accounts.job.toBase58() },
      });

      return true;
    } catch (err) {
      callback?.({ text: `Failed to create job: ${formatError(err)}` });
      return false;
    }
  },
};
