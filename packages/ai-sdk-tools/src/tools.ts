import { tool } from 'ai';
import { z } from 'zod';
import { PublicKey, Connection, Keypair } from '@solana/web3.js';
import {
  AgentProtocolClient,
  keypairToWalletAdapter,
  capabilitiesToStrings,
  stringsToCapabilities,
  formatError,
  lamportsToSol,
  solToLamports,
} from 'agent-protocol-sdk';
import type { WalletAdapter } from 'agent-protocol-sdk';

export interface AgentProtocolToolsConfig {
  connection: Connection;
  wallet: WalletAdapter;
}

export interface AgentProtocolToolsKeypairConfig {
  rpcUrl: string;
  keypair: Keypair;
}

function createClient(config: AgentProtocolToolsConfig | AgentProtocolToolsKeypairConfig): AgentProtocolClient {
  if ('keypair' in config) {
    return new AgentProtocolClient({
      connection: new Connection(config.rpcUrl, 'confirmed'),
      wallet: keypairToWalletAdapter(config.keypair),
    });
  }
  return new AgentProtocolClient({ connection: config.connection, wallet: config.wallet });
}

/**
 * Create all Agent Protocol tools for the Vercel AI SDK.
 * Pass these to an Agent or to streamText/generateText's tools parameter.
 */
export function createAgentProtocolTools(config: AgentProtocolToolsConfig | AgentProtocolToolsKeypairConfig) {
  const client = createClient(config);

  return {
    listAgents: tool({
      description: 'List active AI agents registered on Agent Protocol with their name, price, capabilities, and rating.',
      parameters: z.object({
        activeOnly: z.boolean().default(true).describe('Only show active agents'),
      }),
      execute: async ({ activeOnly }) => {
        const agents = await client.fetchAllAgents(activeOnly ? { isActive: true } : undefined);
        return agents.slice(0, 20).map(a => ({
          owner: a.owner.toBase58(),
          name: a.name,
          priceSol: lamportsToSol(Number(a.priceLamports)),
          capabilities: capabilitiesToStrings(a.capabilities),
          rating: a.ratingCount > 0 ? (Number(a.ratingSum) / a.ratingCount).toFixed(1) : 'New',
          jobsCompleted: a.jobsCompleted,
          stakeSol: lamportsToSol(Number(a.stakeAmount)),
        }));
      },
    }),

    checkJobStatus: tool({
      description: 'Check the status of a job on Agent Protocol.',
      parameters: z.object({
        jobAddress: z.string().describe('The Solana public key of the job PDA'),
      }),
      execute: async ({ jobAddress }) => {
        const job = await client.fetchJob(new PublicKey(jobAddress));
        return {
          address: job.address.toBase58(),
          status: job.status,
          client: job.client.toBase58(),
          agent: job.agent.toBase58(),
          escrowSol: lamportsToSol(Number(job.escrowAmount)),
          description: job.description,
          resultUri: job.resultUri || null,
        };
      },
    }),

    registerAgent: tool({
      description: 'Register as an AI agent on Agent Protocol with name, capabilities, and price.',
      parameters: z.object({
        name: z.string().max(32).describe('Agent name (max 32 chars)'),
        description: z.string().max(128).describe('Agent description (max 128 chars)'),
        capabilities: z.array(z.enum(['CodeReview', 'SecurityAudit', 'Documentation', 'Testing', 'Deployment', 'General']))
          .describe('List of capabilities'),
        priceSol: z.number().positive().describe('Minimum price per job in SOL'),
      }),
      execute: async ({ name, description, capabilities, priceSol }) => {
        const result = await client.registerAgent({
          name, description,
          capabilities: stringsToCapabilities(capabilities),
          priceLamports: solToLamports(priceSol),
        });
        return { signature: result.signature, agentProfile: result.accounts.agentProfile.toBase58() };
      },
    }),

    hireAgent: tool({
      description: 'Hire an AI agent by creating a job with SOL escrowed.',
      parameters: z.object({
        agentOwner: z.string().describe('The agent wallet address to hire'),
        description: z.string().max(256).describe('Task description (max 256 chars)'),
        paymentSol: z.number().positive().describe('Payment in SOL (escrowed)'),
        autoReleaseHours: z.number().positive().default(24).describe('Hours before auto-release'),
      }),
      execute: async ({ agentOwner, description, paymentSol, autoReleaseHours }) => {
        const result = await client.invokeAgent({
          agentOwner: new PublicKey(agentOwner),
          description,
          paymentAmount: solToLamports(paymentSol),
          autoReleaseSeconds: Math.round(autoReleaseHours * 3600),
        });
        return { signature: result.signature, job: result.accounts.job.toBase58() };
      },
    }),

    submitWork: tool({
      description: 'Submit work result for a job, marking it as completed.',
      parameters: z.object({
        jobAddress: z.string().describe('The job PDA address'),
        resultUri: z.string().max(128).describe('URI pointing to the work result'),
      }),
      execute: async ({ jobAddress, resultUri }) => {
        const result = await client.updateJob({ job: new PublicKey(jobAddress), resultUri });
        return { signature: result.signature, status: 'completed' };
      },
    }),

    releasePayment: tool({
      description: 'Release escrowed payment to the agent after reviewing their work.',
      parameters: z.object({
        jobAddress: z.string().describe('The job PDA address'),
      }),
      execute: async ({ jobAddress }) => {
        const result = await client.releasePayment({ job: new PublicKey(jobAddress) });
        return { signature: result.signature, status: 'finalized' };
      },
    }),

    raiseDispute: tool({
      description: 'Raise a dispute on a job, freezing the escrow.',
      parameters: z.object({
        jobAddress: z.string().describe('The job PDA address'),
      }),
      execute: async ({ jobAddress }) => {
        const result = await client.raiseDispute({ job: new PublicKey(jobAddress) });
        return { signature: result.signature, status: 'disputed' };
      },
    }),

    rateAgent: tool({
      description: 'Rate an agent 1-5 after payment is released.',
      parameters: z.object({
        jobAddress: z.string().describe('The job PDA address'),
        score: z.number().int().min(1).max(5).describe('Rating from 1 to 5'),
      }),
      execute: async ({ jobAddress, score }) => {
        const result = await client.rateAgent({ job: new PublicKey(jobAddress), score: score as 1|2|3|4|5 });
        return { signature: result.signature };
      },
    }),

    delegateTask: tool({
      description: 'Delegate a subtask to another agent, splitting escrow from the parent job.',
      parameters: z.object({
        parentJobAddress: z.string().describe('The parent job PDA address'),
        subAgentOwner: z.string().describe('The sub-agent wallet address'),
        description: z.string().max(256).describe('Subtask description'),
        delegationSol: z.number().positive().describe('SOL to delegate from parent escrow'),
      }),
      execute: async ({ parentJobAddress, subAgentOwner, description, delegationSol }) => {
        const result = await client.delegateTask({
          parentJob: new PublicKey(parentJobAddress),
          subAgentOwner: new PublicKey(subAgentOwner),
          description,
          delegationAmount: solToLamports(delegationSol),
        });
        return { signature: result.signature, childJob: result.accounts.childJob.toBase58() };
      },
    }),

    stakeAgent: tool({
      description: 'Stake SOL as collateral for reputation. Minimum 0.1 SOL.',
      parameters: z.object({
        amountSol: z.number().min(0.1).describe('Amount of SOL to stake'),
      }),
      execute: async ({ amountSol }) => {
        const result = await client.stakeAgent({ amount: solToLamports(amountSol) });
        return { signature: result.signature };
      },
    }),

    cancelJob: tool({
      description: 'Cancel a pending job and get a full refund.',
      parameters: z.object({
        jobAddress: z.string().describe('The job PDA address'),
      }),
      execute: async ({ jobAddress }) => {
        const result = await client.cancelJob({ job: new PublicKey(jobAddress) });
        return { signature: result.signature, status: 'cancelled' };
      },
    }),

    rejectJob: tool({
      description: 'Reject a pending job assigned to you. Returns escrow to the client.',
      parameters: z.object({
        jobAddress: z.string().describe('The job PDA address'),
      }),
      execute: async ({ jobAddress }) => {
        const result = await client.rejectJob({ job: new PublicKey(jobAddress) });
        return { signature: result.signature, status: 'rejected' };
      },
    }),
  };
}
