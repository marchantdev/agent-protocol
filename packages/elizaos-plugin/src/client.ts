import { Connection, Keypair } from '@solana/web3.js';
import {
  AgentProtocolClient,
  keypairToWalletAdapter,
} from 'agent-protocol-sdk';
import bs58 from 'bs58';

let cachedClient: AgentProtocolClient | null = null;
let cachedRpc: string | null = null;

/**
 * Get or create an AgentProtocolClient from ElizaOS runtime settings.
 * Expects SOLANA_RPC_URL and SOLANA_PRIVATE_KEY in runtime settings.
 */
export function getClient(runtime: any): AgentProtocolClient {
  const rpcUrl = runtime.getSetting('SOLANA_RPC_URL') || 'https://api.devnet.solana.com';
  const privateKey = runtime.getSetting('SOLANA_PRIVATE_KEY');

  if (!privateKey) {
    throw new Error('SOLANA_PRIVATE_KEY not configured. Set it in your character file settings.');
  }

  // Cache client if RPC hasn't changed
  if (cachedClient && cachedRpc === rpcUrl) {
    return cachedClient;
  }

  let keypair: Keypair;
  try {
    // Try base58 first, then JSON array
    if (privateKey.startsWith('[')) {
      keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(privateKey)));
    } else {
      keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
    }
  } catch {
    throw new Error('Invalid SOLANA_PRIVATE_KEY. Provide a base58 string or JSON byte array.');
  }

  const connection = new Connection(rpcUrl, 'confirmed');
  const wallet = keypairToWalletAdapter(keypair);

  cachedClient = new AgentProtocolClient({ connection, wallet });
  cachedRpc = rpcUrl;
  return cachedClient;
}

/**
 * Get a read-only client (no wallet needed) for query operations.
 */
export function getReadOnlyClient(runtime: any): AgentProtocolClient {
  const rpcUrl = runtime.getSetting('SOLANA_RPC_URL') || 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  // Dummy wallet for read-only operations
  const dummyKeypair = Keypair.generate();
  const wallet = keypairToWalletAdapter(dummyKeypair);

  return new AgentProtocolClient({ connection, wallet });
}
