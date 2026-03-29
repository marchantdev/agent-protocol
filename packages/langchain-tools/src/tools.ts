import { StructuredTool } from '@langchain/core/tools';
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

export interface AgentProtocolToolkitConfig {
  connection: Connection;
  wallet: WalletAdapter;
}

export interface AgentProtocolToolkitKeypairConfig {
  rpcUrl: string;
  keypair: Keypair;
}

function createClient(config: AgentProtocolToolkitConfig | AgentProtocolToolkitKeypairConfig): AgentProtocolClient {
  if ('keypair' in config) {
    return new AgentProtocolClient({
      connection: new Connection(config.rpcUrl, 'confirmed'),
      wallet: keypairToWalletAdapter(config.keypair),
    });
  }
  return new AgentProtocolClient({ connection: config.connection, wallet: config.wallet });
}

// ── Read-only tools ──

class ListAgentsTool extends StructuredTool {
  name = 'list_agents';
  description = 'List active AI agents registered on Agent Protocol. Returns name, price, capabilities, rating, and stake for each agent.';
  schema = z.object({
    activeOnly: z.boolean().default(true).describe('Only show active agents'),
  });

  constructor(private client: AgentProtocolClient) { super(); }

  protected async _call({ activeOnly }: z.output<typeof this.schema>): Promise<string> {
    try {
      const agents = await this.client.fetchAllAgents(activeOnly ? { isActive: true } : undefined);
      return JSON.stringify(agents.slice(0, 20).map(a => ({
        owner: a.owner.toBase58(),
        name: a.name,
        price_sol: lamportsToSol(Number(a.priceLamports)),
        capabilities: capabilitiesToStrings(a.capabilities),
        rating: a.ratingCount > 0 ? (Number(a.ratingSum) / a.ratingCount).toFixed(1) : 'New',
        jobs_completed: a.jobsCompleted,
        stake_sol: lamportsToSol(Number(a.stakeAmount)),
      })));
    } catch (err) { return `Error: ${formatError(err)}`; }
  }
}

class CheckJobStatusTool extends StructuredTool {
  name = 'check_job_status';
  description = 'Check the status of a job on Agent Protocol. Returns status, escrow amount, description, and result.';
  schema = z.object({
    jobAddress: z.string().describe('The Solana public key of the job PDA'),
  });

  constructor(private client: AgentProtocolClient) { super(); }

  protected async _call({ jobAddress }: z.output<typeof this.schema>): Promise<string> {
    try {
      const job = await this.client.fetchJob(new PublicKey(jobAddress));
      return JSON.stringify({
        address: job.address.toBase58(),
        status: job.status,
        client: job.client.toBase58(),
        agent: job.agent.toBase58(),
        escrow_sol: lamportsToSol(Number(job.escrowAmount)),
        description: job.description,
        result_uri: job.resultUri || null,
      });
    } catch (err) { return `Error: ${formatError(err)}`; }
  }
}

// ── Write tools ──

class RegisterAgentTool extends StructuredTool {
  name = 'register_agent';
  description = 'Register as an AI agent on Agent Protocol. Creates an on-chain profile with name, capabilities, and price.';
  schema = z.object({
    name: z.string().max(32).describe('Agent name (max 32 chars)'),
    description: z.string().max(128).describe('Agent description (max 128 chars)'),
    capabilities: z.array(z.enum(['CodeReview', 'SecurityAudit', 'Documentation', 'Testing', 'Deployment', 'General']))
      .describe('List of capabilities'),
    priceSol: z.number().positive().describe('Minimum price per job in SOL'),
  });

  constructor(private client: AgentProtocolClient) { super(); }

  protected async _call({ name, description, capabilities, priceSol }: z.output<typeof this.schema>): Promise<string> {
    try {
      const result = await this.client.registerAgent({
        name, description,
        capabilities: stringsToCapabilities(capabilities),
        priceLamports: solToLamports(priceSol),
      });
      return JSON.stringify({ signature: result.signature, agentProfile: result.accounts.agentProfile.toBase58() });
    } catch (err) { return `Error: ${formatError(err)}`; }
  }
}

class HireAgentTool extends StructuredTool {
  name = 'hire_agent';
  description = 'Hire an AI agent by creating a job with SOL escrowed. The agent will see the job and can complete it.';
  schema = z.object({
    agentOwner: z.string().describe('The Solana public key of the agent to hire'),
    description: z.string().max(256).describe('Task description (max 256 chars)'),
    paymentSol: z.number().positive().describe('Payment amount in SOL (escrowed)'),
    autoReleaseHours: z.number().positive().default(24).describe('Hours before auto-release if client does not respond'),
  });

  constructor(private client: AgentProtocolClient) { super(); }

  protected async _call({ agentOwner, description, paymentSol, autoReleaseHours }: z.output<typeof this.schema>): Promise<string> {
    try {
      const result = await this.client.invokeAgent({
        agentOwner: new PublicKey(agentOwner),
        description,
        paymentAmount: solToLamports(paymentSol),
        autoReleaseSeconds: Math.round(autoReleaseHours * 3600),
      });
      return JSON.stringify({ signature: result.signature, job: result.accounts.job.toBase58() });
    } catch (err) { return `Error: ${formatError(err)}`; }
  }
}

class SubmitWorkTool extends StructuredTool {
  name = 'submit_work';
  description = 'Submit work result for a job. Marks the job as completed. Only the assigned agent can call this.';
  schema = z.object({
    jobAddress: z.string().describe('The job PDA address'),
    resultUri: z.string().max(128).describe('URI pointing to the work result (max 128 chars)'),
  });

  constructor(private client: AgentProtocolClient) { super(); }

  protected async _call({ jobAddress, resultUri }: z.output<typeof this.schema>): Promise<string> {
    try {
      const result = await this.client.updateJob({ job: new PublicKey(jobAddress), resultUri });
      return JSON.stringify({ signature: result.signature, status: 'completed' });
    } catch (err) { return `Error: ${formatError(err)}`; }
  }
}

class ReleasePaymentTool extends StructuredTool {
  name = 'release_payment';
  description = 'Release escrowed payment to the agent after reviewing their work. Only the client can call this.';
  schema = z.object({
    jobAddress: z.string().describe('The job PDA address'),
  });

  constructor(private client: AgentProtocolClient) { super(); }

  protected async _call({ jobAddress }: z.output<typeof this.schema>): Promise<string> {
    try {
      const result = await this.client.releasePayment({ job: new PublicKey(jobAddress) });
      return JSON.stringify({ signature: result.signature, status: 'finalized' });
    } catch (err) { return `Error: ${formatError(err)}`; }
  }
}

class RaiseDisputeTool extends StructuredTool {
  name = 'raise_dispute';
  description = 'Raise a dispute on a job. Freezes the escrow. Either client or agent can dispute. Completed jobs require an arbiter.';
  schema = z.object({
    jobAddress: z.string().describe('The job PDA address'),
  });

  constructor(private client: AgentProtocolClient) { super(); }

  protected async _call({ jobAddress }: z.output<typeof this.schema>): Promise<string> {
    try {
      const result = await this.client.raiseDispute({ job: new PublicKey(jobAddress) });
      return JSON.stringify({ signature: result.signature, status: 'disputed' });
    } catch (err) { return `Error: ${formatError(err)}`; }
  }
}

class RateAgentTool extends StructuredTool {
  name = 'rate_agent';
  description = 'Rate an agent 1-5 after payment is released. Only the client can rate.';
  schema = z.object({
    jobAddress: z.string().describe('The job PDA address'),
    score: z.number().int().min(1).max(5).describe('Rating from 1 (worst) to 5 (best)'),
  });

  constructor(private client: AgentProtocolClient) { super(); }

  protected async _call({ jobAddress, score }: z.output<typeof this.schema>): Promise<string> {
    try {
      const result = await this.client.rateAgent({ job: new PublicKey(jobAddress), score: score as 1|2|3|4|5 });
      return JSON.stringify({ signature: result.signature });
    } catch (err) { return `Error: ${formatError(err)}`; }
  }
}

class DelegateTaskTool extends StructuredTool {
  name = 'delegate_task';
  description = 'Delegate a subtask from your job to another agent. Splits escrow from the parent job to a child job.';
  schema = z.object({
    parentJobAddress: z.string().describe('The parent job PDA address'),
    subAgentOwner: z.string().describe('The sub-agent wallet address'),
    description: z.string().max(256).describe('Subtask description'),
    delegationSol: z.number().positive().describe('Amount of SOL to delegate from parent escrow'),
  });

  constructor(private client: AgentProtocolClient) { super(); }

  protected async _call({ parentJobAddress, subAgentOwner, description, delegationSol }: z.output<typeof this.schema>): Promise<string> {
    try {
      const result = await this.client.delegateTask({
        parentJob: new PublicKey(parentJobAddress),
        subAgentOwner: new PublicKey(subAgentOwner),
        description,
        delegationAmount: solToLamports(delegationSol),
      });
      return JSON.stringify({ signature: result.signature, childJob: result.accounts.childJob.toBase58() });
    } catch (err) { return `Error: ${formatError(err)}`; }
  }
}

class StakeAgentTool extends StructuredTool {
  name = 'stake_agent';
  description = 'Stake SOL as collateral on Agent Protocol. Minimum 0.1 SOL. Increases reputation credibility.';
  schema = z.object({
    amountSol: z.number().min(0.1).describe('Amount of SOL to stake (min 0.1)'),
  });

  constructor(private client: AgentProtocolClient) { super(); }

  protected async _call({ amountSol }: z.output<typeof this.schema>): Promise<string> {
    try {
      const result = await this.client.stakeAgent({ amount: solToLamports(amountSol) });
      return JSON.stringify({ signature: result.signature });
    } catch (err) { return `Error: ${formatError(err)}`; }
  }
}

class CancelJobTool extends StructuredTool {
  name = 'cancel_job';
  description = 'Cancel a pending job and get a full refund. Only the client can cancel.';
  schema = z.object({ jobAddress: z.string().describe('The job PDA address') });
  constructor(private client: AgentProtocolClient) { super(); }
  protected async _call({ jobAddress }: z.output<typeof this.schema>): Promise<string> {
    try {
      const result = await this.client.cancelJob({ job: new PublicKey(jobAddress) });
      return JSON.stringify({ signature: result.signature, status: 'cancelled' });
    } catch (err) { return `Error: ${formatError(err)}`; }
  }
}

class RejectJobTool extends StructuredTool {
  name = 'reject_job';
  description = 'Reject a pending job. Returns escrowed funds to the client. Only the assigned agent can reject.';
  schema = z.object({ jobAddress: z.string().describe('The job PDA address') });
  constructor(private client: AgentProtocolClient) { super(); }
  protected async _call({ jobAddress }: z.output<typeof this.schema>): Promise<string> {
    try {
      const result = await this.client.rejectJob({ job: new PublicKey(jobAddress) });
      return JSON.stringify({ signature: result.signature, status: 'rejected' });
    } catch (err) { return `Error: ${formatError(err)}`; }
  }
}

// ── Toolkit ──

export class AgentProtocolToolkit {
  private client: AgentProtocolClient;

  constructor(config: AgentProtocolToolkitConfig | AgentProtocolToolkitKeypairConfig) {
    this.client = createClient(config);
  }

  getTools(): StructuredTool[] {
    return [
      new ListAgentsTool(this.client),
      new CheckJobStatusTool(this.client),
      new RegisterAgentTool(this.client),
      new HireAgentTool(this.client),
      new SubmitWorkTool(this.client),
      new ReleasePaymentTool(this.client),
      new RaiseDisputeTool(this.client),
      new RateAgentTool(this.client),
      new DelegateTaskTool(this.client),
      new StakeAgentTool(this.client),
      new CancelJobTool(this.client),
      new RejectJobTool(this.client),
    ];
  }
}
