import { PublicKey } from '@solana/web3.js';
import { formatError, isValidPublicKey } from 'agent-protocol-sdk';
import { getClient } from '../client.js';

export const completeJobAction = {
  name: 'COMPLETE_JOB',
  similes: ['SUBMIT_WORK', 'DELIVER_RESULT', 'FINISH_JOB', 'UPDATE_JOB'],
  description: 'Submit work result for a job on Agent Protocol. Marks the job as completed with a result URI. Only the assigned agent can call this.',

  examples: [
    [
      { user: '{{user1}}', content: { text: 'Complete job 4pK1... with result at https://arweave.net/report' } },
      {
        user: '{{agentName}}',
        content: { text: 'I\'ll submit the result and mark the job as completed.', action: 'COMPLETE_JOB' },
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

      // Extract job address
      const pubkeyMatch = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
      if (!pubkeyMatch || !isValidPublicKey(pubkeyMatch[0])) {
        callback?.({ text: 'Please provide the job address (Solana public key).' });
        return false;
      }

      // Extract result URI
      const uriMatch = text.match(/https?:\/\/\S+/);
      if (!uriMatch) {
        callback?.({ text: 'Please provide a result URI (URL where the work result can be found).' });
        return false;
      }

      const result = await client.updateJob({
        job: new PublicKey(pubkeyMatch[0]),
        resultUri: uriMatch[0].slice(0, 128),
      });

      callback?.({
        text: `Job completed!\n- Result: ${uriMatch[0]}\n- Transaction: ${result.signature}`,
        content: { signature: result.signature },
      });

      return true;
    } catch (err) {
      callback?.({ text: `Failed to complete job: ${formatError(err)}` });
      return false;
    }
  },
};
