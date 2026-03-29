import { Connection, Keypair } from '@solana/web3.js';
import {
  AgentProtocolClient,
  keypairToWalletAdapter,
} from 'agent-protocol-sdk';

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
    // Try JSON array first, then raw bytes
    if (privateKey.startsWith('[')) {
      keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(privateKey)));
    } else {
      // Decode base58 without external dependency
      const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      let num = BigInt(0);
      for (const char of privateKey) {
        const idx = ALPHABET.indexOf(char);
        if (idx === -1) throw new Error('Invalid base58 character');
        num = num * BigInt(58) + BigInt(idx);
      }
      const hex = num.toString(16).padStart(128, '0');
      const bytes = new Uint8Array(64);
      for (let i = 0; i < 64; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
      keypair = Keypair.fromSecretKey(bytes);
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
