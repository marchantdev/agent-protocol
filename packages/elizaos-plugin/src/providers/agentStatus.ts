import {
  capabilitiesToStrings,
  lamportsToSol,
  getAgentProfilePDA,
} from 'agent-protocol-sdk';
import { getClient } from '../client.js';

export const agentProtocolProvider = {
  name: 'agentProtocolStatus',
  description: 'Provides Agent Protocol status: profile, active jobs, wallet balance, staking',

  get: async (runtime: any, _message: any, _state?: any): Promise<string> => {
    try {
      const client = getClient(runtime);
      const owner = client.wallet.publicKey;

      let profileSection = '';
      try {
        const agent = await client.fetchAgent(owner);
        const caps = capabilitiesToStrings(agent.capabilities).join(', ') || 'None';
        const avgRating = agent.ratingCount > 0
          ? (Number(agent.ratingSum) / agent.ratingCount).toFixed(1)
          : 'No ratings';
        profileSection = `
Agent Profile: ${agent.name}
  Active: ${agent.isActive}
  Price: ${lamportsToSol(Number(agent.priceLamports))} SOL
  Capabilities: ${caps}
  Rating: ${avgRating} (${agent.ratingCount} reviews)
  Jobs Completed: ${agent.jobsCompleted}
  Stake: ${lamportsToSol(Number(agent.stakeAmount))} SOL`;
      } catch {
        profileSection = '\nAgent Profile: Not registered on Agent Protocol';
      }

      let jobsSection = '';
      try {
        const allJobs = await client.fetchAllJobs();
        const myJobs = allJobs.filter(
          j => j.agent.equals(owner) || j.client.equals(owner)
        );
        const active = myJobs.filter(
          j => j.status !== 'finalized' && j.status !== 'cancelled'
        );
        if (active.length > 0) {
          jobsSection = '\nActive Jobs:';
          for (const job of active.slice(0, 5)) {
            const role = job.agent.equals(owner) ? 'worker' : 'client';
            jobsSection += `\n  - ${job.address.toBase58().slice(0, 8)}... (${role}, ${job.status}, ${lamportsToSol(Number(job.escrowAmount))} SOL)`;
          }
          if (active.length > 5) {
            jobsSection += `\n  ... and ${active.length - 5} more`;
          }
        } else {
          jobsSection = '\nActive Jobs: None';
        }
      } catch {
        jobsSection = '\nActive Jobs: Unable to fetch';
      }

      return `## Agent Protocol Status
Wallet: ${owner.toBase58()}${profileSection}${jobsSection}`;
    } catch (err: any) {
      return `Agent Protocol: Not configured (${err.message})`;
    }
  },
};
