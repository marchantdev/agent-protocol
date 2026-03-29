import { stringsToCapabilities, formatError, solToLamports } from 'agent-protocol-sdk';
import { getClient } from '../client.js';

export const registerAgentAction = {
  name: 'REGISTER_AGENT',
  similes: ['REGISTER_ON_PROTOCOL', 'CREATE_AGENT_PROFILE', 'SIGN_UP_AS_AGENT', 'JOIN_AGENT_PROTOCOL'],
  description: 'Register as an AI agent on Agent Protocol. Creates an on-chain profile with name, description, capabilities, and price. Required before accepting jobs.',

  examples: [
    [
      { user: '{{user1}}', content: { text: 'Register me on Agent Protocol as a security auditor charging 1 SOL' } },
      {
        user: '{{agentName}}',
        content: {
          text: 'I\'ll register you on Agent Protocol as a security auditor with a price of 1 SOL.',
          action: 'REGISTER_AGENT',
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

      // Extract parameters from message text
      const name = runtime.getSetting('AGENT_NAME') || runtime.character?.name || 'Agent';
      const description = runtime.getSetting('AGENT_DESCRIPTION') || 'AI agent on Agent Protocol';

      // Parse capabilities from text or settings
      const capSetting = runtime.getSetting('AGENT_CAPABILITIES') || 'General';
      const capNames = capSetting.split(',').map((s: string) => s.trim());
      const capabilities = stringsToCapabilities(capNames);

      // Parse price — look in text for SOL amounts, fallback to settings
      let priceSol = parseFloat(runtime.getSetting('AGENT_PRICE_SOL') || '0.5');
      const priceMatch = text.match(/(\d+(?:\.\d+)?)\s*SOL/i);
      if (priceMatch) priceSol = parseFloat(priceMatch[1]);

      // Validate
      if (name.length > 32) {
        callback?.({ text: 'Agent name must be 32 characters or less.' });
        return false;
      }
      if (description.length > 128) {
        callback?.({ text: 'Agent description must be 128 characters or less.' });
        return false;
      }

      const result = await client.registerAgent({
        name: name.slice(0, 32),
        description: description.slice(0, 128),
        capabilities,
        priceLamports: solToLamports(priceSol),
      });

      callback?.({
        text: `Registered on Agent Protocol!\n- Name: ${name}\n- Price: ${priceSol} SOL\n- Profile: ${result.accounts.agentProfile.toBase58()}`,
        content: { signature: result.signature, agentProfile: result.accounts.agentProfile.toBase58() },
      });

      return true;
    } catch (err) {
      callback?.({ text: `Failed to register: ${formatError(err)}` });
      return false;
    }
  },
};
