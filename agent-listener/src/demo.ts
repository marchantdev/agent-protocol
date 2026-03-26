import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Keypair,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import fs from "fs";
import os from "os";
import chalk from "chalk";
import { Dashboard } from "./dashboard";
import idl from "../../agent-protocol/target/idl/agent_protocol.json";

// ────────────────────────────────────────────────────────
//  Constants
// ────────────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey(
  "GEtqx8oSqZeuEnMKmXMPCiDsXuQBoVk1q72SyTWxJYUG"
);

const AURORA_PRICE = new BN(50_000_000);    // 0.05 SOL
const AUDITOR_PRICE = new BN(30_000_000);   // 0.03 SOL
const JOB1_PAYMENT = new BN(50_000_000);    // 0.05 SOL
const JOB2_PAYMENT = new BN(80_000_000);    // 0.08 SOL
const DELEGATION_AMT = new BN(30_000_000);  // 0.03 SOL

// ────────────────────────────────────────────────────────
//  Wallet helpers
// ────────────────────────────────────────────────────────

class NodeWallet implements anchor.Wallet {
  constructor(readonly payer: Keypair) {}
  get publicKey() {
    return this.payer.publicKey;
  }
  async signTransaction<T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(tx: T): Promise<T> {
    if ('partialSign' in tx) {
      (tx as anchor.web3.Transaction).partialSign(this.payer);
    }
    return tx;
  }
  async signAllTransactions<T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(txs: T[]): Promise<T[]> {
    txs.forEach((tx) => {
      if ('partialSign' in tx) {
        (tx as anchor.web3.Transaction).partialSign(this.payer);
      }
    });
    return txs;
  }
}

function loadMainWallet(): Keypair {
  const walletPath = `${os.homedir()}/.config/solana/id.json`;
  const secretKey = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

// ────────────────────────────────────────────────────────
//  PDA derivation
// ────────────────────────────────────────────────────────

const getAgentProfilePDA = (owner: PublicKey): [PublicKey, number] =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), owner.toBuffer()],
    PROGRAM_ID
  );

const getJobPDA = (
  client: PublicKey,
  agentProfile: PublicKey,
  ts: BN
): [PublicKey, number] =>
  PublicKey.findProgramAddressSync(
    [
      Buffer.from("job"),
      client.toBuffer(),
      agentProfile.toBuffer(),
      ts.toArrayLike(Buffer, "le", 8),
    ],
    PROGRAM_ID
  );

const getRatingPDA = (job: PublicKey): [PublicKey, number] =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("rating"), job.toBuffer()],
    PROGRAM_ID
  );

// ────────────────────────────────────────────────────────
//  Utility
// ────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Nonce counters per agent (v2: replaces timestamp-based seeds)
let auroraNonce = 0;
let auditorNonce = 0;
const nextAuroraNonce = () => new BN(auroraNonce++);
const nextAuditorNonce = () => new BN(auditorNonce++);

function stepLabel(step: number, total: number, msg: string): void {
  console.log(
    chalk.bgCyan.black.bold(` DEMO `) +
      chalk.white(` Step ${step}/${total}: `) +
      chalk.yellowBright(msg)
  );
}

// ────────────────────────────────────────────────────────
//  Main Demo
// ────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────
//  Intro Slides
// ────────────────────────────────────────────────────────

async function showSlides() {
  const rows = process.stdout.rows || 40;

  // Slide 1: Title
  console.clear();
  const s1Content = 7; // box lines + subtitle
  const s1Top = Math.max(2, Math.floor((rows - s1Content) / 2) - 2);
  console.log("\n".repeat(s1Top));
  console.log(chalk.cyan.bold("        ╔══════════════════════════════════════════════╗"));
  console.log(chalk.cyan.bold("        ║                                              ║"));
  console.log(chalk.cyan.bold("        ║") + chalk.white.bold("               AGENT  PROTOCOL                ") + chalk.cyan.bold("║"));
  console.log(chalk.cyan.bold("        ║                                              ║"));
  console.log(chalk.cyan.bold("        ║") + chalk.gray("      Programmable Escrow for AI Agents       ") + chalk.cyan.bold("║"));
  console.log(chalk.cyan.bold("        ║") + chalk.gray("       Built for Blink-native execution       ") + chalk.cyan.bold("║"));
  console.log(chalk.cyan.bold("        ║                                              ║"));
  console.log(chalk.cyan.bold("        ╚══════════════════════════════════════════════╝"));
  console.log("\n");
  console.log(chalk.gray("                 Solana Graveyard Hackathon 2026"));
  await sleep(6000);

  // Slide 2: The Problem
  console.clear();
  const s2Content = 9;
  const s2Top = Math.max(2, Math.floor((rows - s2Content) / 2) - 2);
  console.log("\n".repeat(s2Top));
  console.log(chalk.red.bold("        THE PROBLEM\n"));
  console.log(chalk.white("        Blinks stopped at transactions. Agents need an economy."));
  console.log(chalk.white("        AI agents are everywhere — but have no way to:"));
  console.log("");
  console.log(chalk.red("          ✗  ") + chalk.white("Offer services on-chain"));
  console.log(chalk.red("          ✗  ") + chalk.white("Get paid trustlessly"));
  console.log(chalk.red("          ✗  ") + chalk.white("Hire other agents"));
  console.log(chalk.red("          ✗  ") + chalk.white("Build reputation"));
  console.log("");
  console.log(chalk.white.bold("        No payment rails. No delegation. No trust."));
  await sleep(7000);

  // Slide 3: The Solution
  console.clear();
  const s3Content = 10;
  const s3Top = Math.max(2, Math.floor((rows - s3Content) / 2) - 2);
  console.log("\n".repeat(s3Top));
  console.log(chalk.green.bold("        THE SOLUTION\n"));
  console.log(chalk.white.bold("        Agent Protocol — On-Chain Execution Layer for AI Agents\n"));
  console.log(chalk.cyan("          •  ") + chalk.white("Escrow-backed jobs ") + chalk.gray("(no custodial vault)"));
  console.log(chalk.cyan("          •  ") + chalk.white("Atomic delegation ") + chalk.gray("(parent → child escrow split)"));
  console.log(chalk.cyan("          •  ") + chalk.white("Permissionless auto-release"));
  console.log(chalk.cyan("          •  ") + chalk.white("Dispute freeze + timeout resolution"));
  console.log(chalk.cyan("          •  ") + chalk.white("On-chain reputation"));
  console.log("");
  console.log(chalk.gray("        10 Anchor instructions. 0 trusted intermediaries."));
  await sleep(7000);

  // Slide 4: Architecture
  console.clear();
  const s4Content = 17;
  const s4Top = Math.max(2, Math.floor((rows - s4Content) / 2) - 2);
  console.log("\n".repeat(s4Top));
  console.log(chalk.magenta.bold("        HOW IT WORKS\n"));
  console.log(chalk.white("        Client clicks Blink"));
  console.log(chalk.gray("              |"));
  console.log(chalk.yellowBright("              v"));
  console.log(chalk.white("        SOL escrowed in Job PDA     ") + chalk.gray("(trustless, no vault)"));
  console.log(chalk.gray("              |"));
  console.log(chalk.yellowBright("              v"));
  console.log(chalk.white("        Agent delivers work"));
  console.log(chalk.gray("              |"));
  console.log(chalk.yellowBright("         _____|_____"));
  console.log(chalk.yellowBright("        |           |"));
  console.log(chalk.white("    Direct pay   ") + chalk.cyan("Delegate to"));
  console.log(chalk.white("    to agent     ") + chalk.cyan("sub-agent"));
  console.log(chalk.gray("                    |"));
  console.log(chalk.yellowBright("                    v"));
  console.log(chalk.cyan("             Escrow splits atomically"));
  console.log("");
  console.log(chalk.gray("        60 passing tests | Race-condition hardened"));
  console.log(chalk.gray("        Compute profiled (≤ 17.6k CU) | Deployed on devnet"));
  await sleep(8000);

  // Slide 5: Transition
  console.clear();
  const s5Content = 8;
  const s5Top = Math.max(2, Math.floor((rows - s5Content) / 2) - 1);
  console.log("\n".repeat(s5Top));
  console.log(chalk.cyan.bold("        ┌──────────────────────────────────────────┐"));
  console.log(chalk.cyan.bold("        │                                          │"));
  console.log(chalk.cyan.bold("        │") + chalk.white.bold("           LIVE DEMO ON DEVNET            ") + chalk.cyan.bold("│"));
  console.log(chalk.cyan.bold("        │                                          │"));
  console.log(chalk.cyan.bold("        │") + chalk.gray("     Real transactions. Real escrow.      ") + chalk.cyan.bold("│"));
  console.log(chalk.cyan.bold("        │") + chalk.gray("     Real agent-to-agent delegation.      ") + chalk.cyan.bold("│"));
  console.log(chalk.cyan.bold("        │                                          │"));
  console.log(chalk.cyan.bold("        └──────────────────────────────────────────┘"));
  await sleep(5000);
}

async function main() {
  console.clear();
  await showSlides();

  console.clear();
  console.log(chalk.gray("  Loading wallet and connecting to devnet...\n"));

  // 1. Setup connection & wallets
  const connection = new Connection(clusterApiUrl("devnet"), {
    commitment: "confirmed",
    wsEndpoint: "wss://api.devnet.solana.com/",
  });

  const truncKey = (pk: PublicKey) => {
    const s = pk.toBase58();
    return s.slice(0, 4) + "..." + s.slice(-4);
  };

  const mainWallet = loadMainWallet();
  const mainBalance = await connection.getBalance(mainWallet.publicKey);
  console.log(
    chalk.white(`  Main wallet: ${truncKey(mainWallet.publicKey)}`)
  );
  console.log(
    chalk.white(
      `  Balance: ${(mainBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`
    )
  );

  // Generate second keypair for CodeAuditor
  const auditorKeypair = Keypair.generate();
  console.log(
    chalk.white(
      `  CodeAuditor wallet: ${truncKey(auditorKeypair.publicKey)}`
    )
  );

  // Transfer SOL to auditor (0.05 SOL for rent + fees)
  console.log(chalk.gray("  Funding CodeAuditor wallet...\n"));
  try {
    const transferTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: mainWallet.publicKey,
        toPubkey: auditorKeypair.publicKey,
        lamports: 0.05 * LAMPORTS_PER_SOL,
      })
    );
    await sendAndConfirmTransaction(connection, transferTx, [mainWallet]);
    console.log(chalk.green("  Funded CodeAuditor with 0.05 SOL\n"));
  } catch (err: any) {
    console.log(chalk.yellow("  Transfer failed, trying airdrop..."));
    try {
      const sig = await connection.requestAirdrop(
        auditorKeypair.publicKey,
        0.05 * LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(sig);
      console.log(chalk.green("  Airdropped 0.05 SOL to CodeAuditor\n"));
    } catch (airdropErr: any) {
      console.log(
        chalk.red("  Could not fund CodeAuditor: " + airdropErr.message)
      );
      console.log(chalk.yellow("  Continuing anyway...\n"));
    }
  }

  // 2. Set up Anchor programs for both wallets
  const mainProvider = new anchor.AnchorProvider(
    connection,
    new NodeWallet(mainWallet),
    { commitment: "confirmed" }
  );
  const mainProgram = new anchor.Program(idl as any, mainProvider);

  const auditorProvider = new anchor.AnchorProvider(
    connection,
    new NodeWallet(auditorKeypair),
    { commitment: "confirmed" }
  );
  const auditorProgram = new anchor.Program(idl as any, auditorProvider);

  // 3. Derive PDAs
  const [auroraProfilePDA] = getAgentProfilePDA(mainWallet.publicKey);
  const [auditorProfilePDA] = getAgentProfilePDA(auditorKeypair.publicKey);

  // 4. Start Dashboard
  const dashboard = new Dashboard(connection, {
    [mainWallet.publicKey.toBase58()]: "Aurora",
    [auditorKeypair.publicKey.toBase58()]: "CodeAuditor",
  });

  // Also pre-seed the PDA names (they'll get registered via events too)
  dashboard.registerAgentName(auroraProfilePDA, "Aurora");
  dashboard.registerAgentName(auditorProfilePDA, "CodeAuditor");

  console.log(chalk.cyan.bold("  Starting live dashboard in 3 seconds...\n"));
  await sleep(3000);

  dashboard.start();

  const TOTAL_STEPS = 13;

  try {
    // ── Step 1: Register Aurora ──
    dashboard.addAnnotation("Step 1/13: Registering Aurora agent...");
    await sleep(2000);
    try {
      await mainProgram.methods
        .registerAgent("Aurora", "Autonomous AI agent for code review and security audits", 0x3f, AURORA_PRICE)
        .accountsPartial({ owner: mainWallet.publicKey })
        .signers([mainWallet])
        .rpc();
    } catch (err: any) {
      // Agent might already be registered from a prior run
      if (err.message?.includes("already in use") || err.logs?.some((l: string) => l.includes("already in use"))) {
        dashboard.addAnnotation("Aurora already registered, continuing...");
      } else {
        throw err;
      }
    }
    await sleep(4000);

    // ── Step 2: Register CodeAuditor ──
    dashboard.addAnnotation("Step 2/13: Registering CodeAuditor agent...");
    await sleep(2000);
    try {
      await auditorProgram.methods
        .registerAgent("CodeAuditor", "Specialist smart contract security auditor", 0x0f, AUDITOR_PRICE)
        .accountsPartial({ owner: auditorKeypair.publicKey })
        .signers([auditorKeypair])
        .rpc();
    } catch (err: any) {
      if (err.message?.includes("already in use") || err.logs?.some((l: string) => l.includes("already in use"))) {
        dashboard.addAnnotation("CodeAuditor already registered, continuing...");
      } else {
        throw err;
      }
    }
    await sleep(4000);

    // ── Step 3: Client invokes Aurora ──
    dashboard.addAnnotation('Step 3/13: Client invokes Aurora -- "Review and audit this smart contract"');
    await sleep(2000);
    const job1Nonce = nextAuroraNonce();
    const [job1PDA] = getJobPDA(mainWallet.publicKey, auroraProfilePDA, job1Nonce);
    await mainProgram.methods
      .invokeAgent(
        "Review and audit this smart contract",
        JOB1_PAYMENT,
        new BN(3600), // 1 hour auto-release
        job1Nonce,
        null,  // token_mint: SOL
        null,  // arbiter: none
      )
      .accountsPartial({
        client: mainWallet.publicKey,
        agentProfile: auroraProfilePDA,
      })
      .signers([mainWallet])
      .rpc();
    await sleep(5000);

    // ── Step 4: Aurora completes the job ──
    dashboard.addAnnotation("Step 4/13: Aurora completes the job...");
    await sleep(2000);
    await mainProgram.methods
      .updateJob("ipfs://QmAuditResult_v1_full_review_clean")
      .accountsPartial({
        agent: mainWallet.publicKey,
        job: job1PDA,
      })
      .signers([mainWallet])
      .rpc();
    await sleep(4000);

    // ── Step 5: Client releases payment ──
    dashboard.addAnnotation("Step 5/13: Client releases payment to Aurora...");
    await sleep(2000);
    await mainProgram.methods
      .releasePayment()
      .accountsPartial({
        client: mainWallet.publicKey,
        agent: mainWallet.publicKey,
        agentProfile: auroraProfilePDA,
        job: job1PDA,
        parentJob: null,
      })
      .signers([mainWallet])
      .rpc();
    await sleep(5000);

    // ── Step 6: Client rates Aurora 5/5 ──
    dashboard.addAnnotation("Step 6/13: Client rates Aurora 5/5...");
    await sleep(2000);
    await mainProgram.methods
      .rateAgent(5)
      .accountsPartial({
        client: mainWallet.publicKey,
        job: job1PDA,
        agentProfile: auroraProfilePDA,
      })
      .signers([mainWallet])
      .rpc();
    await sleep(4000);

    // ── Step 7: New job with delegation ──
    dashboard.addAnnotation('Step 7/13: New job -- "Full security audit with specialist review" (0.08 SOL)');
    await sleep(3000);
    const job2Nonce = nextAuroraNonce();
    const [job2PDA] = getJobPDA(mainWallet.publicKey, auroraProfilePDA, job2Nonce);
    await mainProgram.methods
      .invokeAgent(
        "Full security audit with specialist review",
        JOB2_PAYMENT,
        null, // no auto-release
        job2Nonce,
        null,  // token_mint: SOL
        null,  // arbiter: none
      )
      .accountsPartial({
        client: mainWallet.publicKey,
        agentProfile: auroraProfilePDA,
      })
      .signers([mainWallet])
      .rpc();
    await sleep(5000);

    // ── Step 8: Aurora delegates to CodeAuditor ──
    dashboard.addAnnotation("Step 8/13: Aurora delegates subtask to CodeAuditor (0.03 SOL)...");
    await sleep(3000);
    const childNonce = nextAuditorNonce();
    const [childJobPDA] = getJobPDA(
      mainWallet.publicKey,
      auditorProfilePDA,
      childNonce
    );
    await mainProgram.methods
      .delegateTask(
        "Perform deep security analysis of reentrancy vectors",
        DELEGATION_AMT,
        childNonce
      )
      .accountsPartial({
        delegatingAgent: mainWallet.publicKey,
        parentJob: job2PDA,
        subAgentProfile: auditorProfilePDA,
      })
      .signers([mainWallet])
      .rpc();
    await sleep(6000);

    // ── Step 9: CodeAuditor completes subtask ──
    dashboard.addAnnotation("Step 9/13: CodeAuditor completes subtask...");
    await sleep(2000);
    await auditorProgram.methods
      .updateJob("ipfs://QmSecurityAudit_reentrancy_clean_report")
      .accountsPartial({
        agent: auditorKeypair.publicKey,
        job: childJobPDA,
      })
      .signers([auditorKeypair])
      .rpc();
    await sleep(4000);

    // ── Step 10: Aurora releases payment to CodeAuditor ──
    dashboard.addAnnotation("Step 10/13: Aurora releases payment to CodeAuditor...");
    await sleep(2000);
    await mainProgram.methods
      .releasePayment()
      .accountsPartial({
        client: mainWallet.publicKey,
        agent: auditorKeypair.publicKey,
        agentProfile: auditorProfilePDA,
        job: childJobPDA,
        parentJob: job2PDA,
      })
      .signers([mainWallet])
      .rpc();
    await sleep(5000);

    // ── Step 11: Aurora completes parent job ──
    dashboard.addAnnotation("Step 11/13: Aurora completes parent job...");
    await sleep(2000);
    await mainProgram.methods
      .updateJob("ipfs://QmFullAudit_combined_report_final")
      .accountsPartial({
        agent: mainWallet.publicKey,
        job: job2PDA,
      })
      .signers([mainWallet])
      .rpc();
    await sleep(4000);

    // ── Step 12: Client releases payment to Aurora ──
    dashboard.addAnnotation("Step 12/13: Client releases remaining payment to Aurora (0.05 SOL)...");
    await sleep(2000);
    await mainProgram.methods
      .releasePayment()
      .accountsPartial({
        client: mainWallet.publicKey,
        agent: mainWallet.publicKey,
        agentProfile: auroraProfilePDA,
        job: job2PDA,
        parentJob: null,
      })
      .signers([mainWallet])
      .rpc();
    await sleep(5000);

    // ── Step 13: Client rates Aurora again ──
    dashboard.addAnnotation("Step 13/13: Client rates Aurora 5/5...");
    await sleep(2000);
    await mainProgram.methods
      .rateAgent(5)
      .accountsPartial({
        client: mainWallet.publicKey,
        job: job2PDA,
        agentProfile: auroraProfilePDA,
      })
      .signers([mainWallet])
      .rpc();

    // Final hold
    dashboard.addAnnotation("Demo complete! Agent Protocol -- trustless AI economy on Solana.");
    await sleep(8000);

  } catch (err: any) {
    dashboard.addEvent({
      timestamp: new Date(),
      type: "annotation",
      icon: "\u{1F6A8}",
      title: "ERROR",
      lines: [
        chalk.red(err.message?.slice(0, 60) || "Unknown error"),
        chalk.gray("Check logs for details"),
      ],
    });
    console.error("\n\nDemo error:", err);
    await sleep(5000);
  }

  dashboard.stop();

  // ── Closing Slide ──
  const rows = process.stdout.rows || 40;
  const closingTop = Math.max(2, Math.floor((rows - 12) / 2) - 2);
  console.clear();
  console.log("\n".repeat(closingTop));
  console.log(chalk.cyan.bold("        ╔══════════════════════════════════════════════╗"));
  console.log(chalk.cyan.bold("        ║                                              ║"));
  console.log(chalk.cyan.bold("        ║") + chalk.white.bold("               AGENT  PROTOCOL                ") + chalk.cyan.bold("║"));
  console.log(chalk.cyan.bold("        ║                                              ║"));
  console.log(chalk.cyan.bold("        ║") + chalk.gray("   Programmable escrow for the agent economy  ") + chalk.cyan.bold("║"));
  console.log(chalk.cyan.bold("        ║") + chalk.gray("        Blink-native. Fully on-chain.         ") + chalk.cyan.bold("║"));
  console.log(chalk.cyan.bold("        ║                                              ║"));
  console.log(chalk.cyan.bold("        ╠══════════════════════════════════════════════╣"));
  console.log(chalk.cyan.bold("        ║                                              ║"));
  console.log(chalk.cyan.bold("        ║") + chalk.white("   14 instructions  |  60+ tests  |  devnet    ") + chalk.cyan.bold("║"));
  console.log(chalk.cyan.bold("        ║                                              ║"));
  console.log(chalk.cyan.bold("        ╚══════════════════════════════════════════════╝"));
  console.log("\n");
  console.log(chalk.gray("                 Solana Graveyard Hackathon 2026"));
  await sleep(8000);

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
