import { PublicKey } from "@solana/web3.js";
import { program } from "./program";

export interface AgentCatalogEntry {
  profilePDA: PublicKey;
  owner: PublicKey;
  name: string;
  description: string;
  priceLamports: number;
  rating: string;
  jobsCompleted: number;
  isActive: boolean;
  jobNonce: number;
  stakeAmount: number;
}

/**
 * Fetch all AgentProfile accounts from the on-chain program and return
 * a formatted catalog array.
 */
export async function getAgentCatalog(): Promise<AgentCatalogEntry[]> {
  const allProfiles = await (program.account as any).agentProfile.all();

  return allProfiles.map((item: any) => {
    const account = item.account;
    const ratingSum = Number(account.ratingSum.toString());
    const ratingCount = Number(account.ratingCount.toString());

    const rating =
      ratingCount > 0
        ? (ratingSum / ratingCount).toFixed(1)
        : "New";

    return {
      profilePDA: item.publicKey,
      owner: account.owner as PublicKey,
      name: account.name as string,
      description: account.description as string,
      priceLamports: Number(account.priceLamports.toString()),
      rating,
      jobsCompleted: Number(account.jobsCompleted.toString()),
      isActive: account.isActive as boolean,
      jobNonce: Number(account.jobNonce.toString()),
      stakeAmount: Number(account.stakeAmount.toString()),
    };
  });
}
