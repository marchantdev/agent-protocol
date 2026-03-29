import { formatError, solToLamports } from 'agent-protocol-sdk';
import { getClient } from '../client.js';

export const stakeAgentAction = {
  name: 'STAKE_AGENT',
  similes: ['STAKE', 'DEPOSIT_COLLATERAL', 'ADD_STAKE'],
  description: 'Stake SOL as collateral on Agent Protocol. Increases reputation credibility. Minimum 0.1 SOL. Staked SOL can be slashed if you lose a dispute.',

  examples: [
    [
      { user: '{{user1}}', content: { text: 'Stake 1 SOL on Agent Protocol' } },
      { user: '{{agentName}}', content: { text: 'I\'ll stake 1 SOL as collateral.', action: 'STAKE_AGENT' } },
    ],
  ],

  validate: async (runtime: any): Promise<boolean> => !!runtime.getSetting('SOLANA_PRIVATE_KEY'),

  handler: async (runtime: any, message: any, _s?: any, _o?: any, callback?: (r: any) => void): Promise<boolean> => {
    try {
      const client = getClient(runtime);
      const text = message.content?.text || '';
      const solMatch = text.match(/(\d+(?:\.\d+)?)\s*SOL/i);
      const amount = solMatch ? parseFloat(solMatch[1]) : 0.1;

      const result = await client.stakeAgent({ amount: solToLamports(amount) });
      callback?.({ text: `Staked ${amount} SOL! Transaction: ${result.signature}` });
      return true;
    } catch (err) {
      callback?.({ text: `Failed to stake: ${formatError(err)}` });
      return false;
    }
  },
};

export const unstakeAgentAction = {
  name: 'UNSTAKE_AGENT',
  similes: ['UNSTAKE', 'WITHDRAW_STAKE', 'REMOVE_COLLATERAL'],
  description: 'Withdraw staked SOL from Agent Protocol.',

  examples: [
    [
      { user: '{{user1}}', content: { text: 'Unstake 0.5 SOL' } },
      { user: '{{agentName}}', content: { text: 'I\'ll withdraw 0.5 SOL from your stake.', action: 'UNSTAKE_AGENT' } },
    ],
  ],

  validate: async (runtime: any): Promise<boolean> => !!runtime.getSetting('SOLANA_PRIVATE_KEY'),

  handler: async (runtime: any, message: any, _s?: any, _o?: any, callback?: (r: any) => void): Promise<boolean> => {
    try {
      const client = getClient(runtime);
      const text = message.content?.text || '';
      const solMatch = text.match(/(\d+(?:\.\d+)?)\s*SOL/i);
      if (!solMatch) { callback?.({ text: 'Please specify amount to unstake (e.g., "0.5 SOL").' }); return false; }

      const result = await client.unstakeAgent({ amount: solToLamports(parseFloat(solMatch[1])) });
      callback?.({ text: `Unstaked ${solMatch[1]} SOL! Transaction: ${result.signature}` });
      return true;
    } catch (err) {
      callback?.({ text: `Failed to unstake: ${formatError(err)}` });
      return false;
    }
  },
};
