import { Router, Request, Response } from "express";
import { PublicKey, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { connection, program, getAgentProfilePDA, getJobPDA } from "../lib/program";
import { getAgentCatalog } from "../lib/agents";

const router = Router();

/**
 * GET /api/actions/invoke
 *
 * Returns the ActionGetResponse describing available agents and
 * interaction parameters for Solana Blinks.
 */
router.get("/api/actions/invoke", async (_req: Request, res: Response) => {
  try {
    const agents = await getAgentCatalog();
    const activeAgents = agents.filter((a) => a.isActive);

    // Deduplicate by name — keep the agent with the most jobs completed
    const bestByName = new Map<string, typeof activeAgents[0]>();
    for (const agent of activeAgents) {
      const existing = bestByName.get(agent.name);
      if (!existing || agent.jobsCompleted > existing.jobsCompleted) {
        bestByName.set(agent.name, agent);
      }
    }
    const uniqueAgents = Array.from(bestByName.values());

    // Build one button per unique active agent
    const agentButtons = uniqueAgents.map((agent) => {
      const priceSOL = (agent.priceLamports / 1e9).toFixed(2);
      const starRating = agent.rating === "New" ? "New" : `${agent.rating}`;
      const stakeSOL = (agent.stakeAmount / 1e9).toFixed(2);
      const stakeLabel = agent.stakeAmount > 0 ? ` | ${stakeSOL} staked` : "";
      const label = `${agent.name} (${starRating} | ${agent.jobsCompleted} jobs | ${priceSOL} SOL${stakeLabel})`;

      return {
        type: "transaction" as const,
        label,
        href: `/api/actions/invoke?agent=${agent.owner.toBase58()}`,
      };
    });

    const defaultAgentOwner =
      uniqueAgents.length > 0
        ? uniqueAgents[0].owner.toBase58()
        : "";

    const actions: any[] = [...agentButtons];

    if (defaultAgentOwner) {
      actions.push({
        type: "transaction",
        label: "Custom Task",
        href: `/api/actions/invoke?agent=${defaultAgentOwner}&task={task}`,
        parameters: [
          {
            name: "task",
            label: "Describe your task",
            type: "textarea",
            required: true,
          },
        ],
      });
    }

    const response = {
      type: "action",
      icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
      title: "Agent Protocol v2 — Hire an AI Agent",
      description:
        "Trustless AI agent marketplace on Solana. SOL + USDC escrow, agent staking, arbiter disputes, and on-chain reputation. Blink-native.",
      label: "Hire Agent",
      links: {
        actions,
      },
    };

    return res.json(response);
  } catch (err: any) {
    console.error("GET /api/actions/invoke error:", err);
    return res.status(500).json({
      error: `Failed to fetch agent catalog: ${err.message}`,
    });
  }
});

/**
 * POST /api/actions/invoke?agent=PUBKEY&task=DESCRIPTION
 *
 * Receives the user's wallet pubkey in the body and builds an unsigned
 * invoke_agent transaction for the wallet to sign.
 * Uses nonce-based PDA derivation (reads agent profile's current nonce).
 */
router.post("/api/actions/invoke", async (req: Request, res: Response) => {
  try {
    const { account } = req.body;
    if (!account) {
      return res.status(400).json({ error: "Missing 'account' in request body" });
    }

    const agentOwnerStr = req.query.agent as string;
    if (!agentOwnerStr) {
      return res.status(400).json({ error: "Missing 'agent' query parameter" });
    }

    let clientPubkey: PublicKey;
    try {
      clientPubkey = new PublicKey(account);
    } catch {
      return res.status(400).json({ error: "Invalid 'account' public key" });
    }

    let agentOwner: PublicKey;
    try {
      agentOwner = new PublicKey(agentOwnerStr);
    } catch {
      return res.status(400).json({ error: "Invalid 'agent' public key" });
    }

    const task = (req.query.task as string) || "General task";

    // Derive the AgentProfile PDA
    const [agentProfilePDA] = getAgentProfilePDA(agentOwner);

    // Fetch the on-chain profile to get price and current nonce
    let profile: any;
    try {
      profile = await (program.account as any).agentProfile.fetch(agentProfilePDA);
    } catch {
      return res.status(404).json({
        error: `Agent profile not found for owner ${agentOwnerStr}`,
      });
    }

    if (!profile.isActive) {
      return res.status(400).json({ error: "Agent is not currently active" });
    }

    // Use the agent's current nonce for PDA derivation
    const nonce = new BN(profile.jobNonce.toString());
    const payment = new BN(profile.priceLamports.toString());
    const autoRelease = new BN(3600); // 1 hour default

    const [jobPDA] = getJobPDA(clientPubkey, agentProfilePDA, nonce);

    const ix = await program.methods
      .invokeAgent(
        task,
        payment,
        autoRelease,
        nonce,
        null,  // token_mint: None (SOL job)
        null,  // arbiter: None
      )
      .accountsPartial({
        client: clientPubkey,
        agentProfile: agentProfilePDA,
        job: jobPDA,
      })
      .instruction();

    const { blockhash } = await connection.getLatestBlockhash();

    const tx = new Transaction({
      recentBlockhash: blockhash,
      feePayer: clientPubkey,
    }).add(ix);

    const serializedTx = tx
      .serialize({ requireAllSignatures: false })
      .toString("base64");

    const priceSOL = (Number(payment.toString()) / 1e9).toFixed(2);

    return res.json({
      type: "transaction",
      transaction: serializedTx,
      message: `Hiring ${profile.name} for "${task}" — ${priceSOL} SOL escrowed`,
    });
  } catch (err: any) {
    console.error("POST /api/actions/invoke error:", err);
    return res.status(500).json({
      error: `Failed to build transaction: ${err.message}`,
    });
  }
});

export default router;
