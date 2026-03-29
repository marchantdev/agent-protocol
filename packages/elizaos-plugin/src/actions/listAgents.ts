import { capabilitiesToStrings, lamportsToSol } from 'agent-protocol-sdk';
import { getReadOnlyClient } from '../client.js';

export const listAgentsAction = {
  name: 'LIST_AGENTS',
  similes: ['BROWSE_AGENTS', 'FIND_AGENTS', 'SEARCH_AGENTS', 'SHOW_AGENTS', 'AVAILABLE_AGENTS'],
  description: 'List available AI agents registered on Agent Protocol. Shows name, price, capabilities, rating, and stake for each active agent.',

  examples: [
    [
      { user: '{{user1}}', content: { text: 'Show me available agents on Agent Protocol' } },
      {
        user: '{{agentName}}',
        content: { text: 'Let me fetch the list of registered agents.', action: 'LIST_AGENTS' },
      },
    ],
  ],

  validate: async (runtime: any): Promise<boolean> => {
    return !!runtime.getSetting('SOLANA_RPC_URL');
  },

  handler: async (
    runtime: any,
    _message: any,
    _state?: any,
    _options?: any,
    callback?: (response: any) => void,
  ): Promise<boolean> => {
    try {
      const client = getReadOnlyClient(runtime);
      const agents = await client.fetchAllAgents({ isActive: true });

      if (agents.length === 0) {
        callback?.({ text: 'No active agents found on Agent Protocol.' });
        return true;
      }

      const lines = agents.slice(0, 10).map(a => {
        const caps = capabilitiesToStrings(a.capabilities).join(', ') || 'General';
        const rating = a.ratingCount > 0
          ? `${(Number(a.ratingSum) / a.ratingCount).toFixed(1)}/5`
          : 'New';
        const stake = lamportsToSol(Number(a.stakeAmount));
        return `- **${a.name}** (${a.owner.toBase58().slice(0, 8)}...)\n  ${caps} | ${lamportsToSol(Number(a.priceLamports))} SOL | ${rating} | ${a.jobsCompleted} jobs | ${stake} SOL staked`;
      });

      let text = `Found ${agents.length} active agent${agents.length > 1 ? 's' : ''}:\n\n${lines.join('\n\n')}`;
      if (agents.length > 10) {
        text += `\n\n... and ${agents.length - 10} more`;
      }

      callback?.({ text });
      return true;
    } catch (err: any) {
      callback?.({ text: `Failed to list agents: ${err.message}` });
      return false;
    }
  },
};
