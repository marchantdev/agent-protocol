import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, clusterApiUrl, Logs } from "@solana/web3.js";
import chalk from "chalk";
import BN from "bn.js";
import idl from "../../agent-protocol/target/idl/agent_protocol.json";

// ────────────────────────────────────────────────────────
//  Constants
// ────────────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey(
  "GEtqx8oSqZeuEnMKmXMPCiDsXuQBoVk1q72SyTWxJYUG"
);

const LAMPORTS_PER_SOL = 1_000_000_000;
const MAX_EVENTS = 20;
const BOX_WIDTH = 72;

// ────────────────────────────────────────────────────────
//  Types
// ────────────────────────────────────────────────────────

export interface DashboardEvent {
  timestamp: Date;
  type: string;
  icon: string;
  title: string;
  lines: string[];
}

// ────────────────────────────────────────────────────────
//  Anchor setup (read-only provider)
// ────────────────────────────────────────────────────────

function createReadOnlyProvider(connection: Connection): anchor.AnchorProvider {
  return new anchor.AnchorProvider(
    connection,
    {
      publicKey: PublicKey.default,
      signTransaction: async (tx: any) => tx,
      signAllTransactions: async (txs: any) => txs,
    } as any,
    { commitment: "confirmed" }
  );
}

// ────────────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────────────

function truncatePubkey(pk: PublicKey | string): string {
  const s = typeof pk === "string" ? pk : pk.toBase58();
  if (s.length <= 12) return s;
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

function lamportsToSol(lamports: BN | number): string {
  const n = typeof lamports === "number" ? lamports : lamports.toNumber();
  return (n / LAMPORTS_PER_SOL).toFixed(4);
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour12: false });
}

// ────────────────────────────────────────────────────────
//  Dashboard Class
// ────────────────────────────────────────────────────────

export class Dashboard {
  private connection: Connection;
  private eventParser: anchor.EventParser;
  private events: DashboardEvent[] = [];
  private subscriptionId: number | null = null;
  private agentNames: Map<string, string> = new Map();
  private agentCount: number = 0;
  private totalEscrow: number = 0;
  private totalStaked: number = 0;
  private jobCount: number = 0;
  private renderInterval: NodeJS.Timeout | null = null;
  private startTime: Date;

  constructor(
    connection?: Connection,
    preseededNames?: Record<string, string>
  ) {
    this.connection =
      connection ||
      new Connection(clusterApiUrl("devnet"), {
        commitment: "confirmed",
        wsEndpoint: "wss://api.devnet.solana.com/",
      });
    this.startTime = new Date();

    const provider = createReadOnlyProvider(this.connection);
    const program = new anchor.Program(idl as any, provider);
    this.eventParser = new anchor.EventParser(
      program.programId,
      new anchor.BorshCoder(program.idl)
    );

    if (preseededNames) {
      for (const [key, name] of Object.entries(preseededNames)) {
        this.agentNames.set(key, name);
      }
    }
  }

  private resolveName(pk: PublicKey | string): string {
    const s = typeof pk === "string" ? pk : pk.toBase58();
    return this.agentNames.get(s) || truncatePubkey(s);
  }

  public registerAgentName(pubkey: PublicKey | string, name: string): void {
    const s = typeof pubkey === "string" ? pubkey : pubkey.toBase58();
    this.agentNames.set(s, name);
  }

  public start(): void {
    this.render();

    this.subscriptionId = this.connection.onLogs(
      PROGRAM_ID,
      (logInfo: Logs) => {
        if (logInfo.err) return;
        this.processLogs(logInfo.logs);
      },
      "confirmed"
    );

    this.renderInterval = setInterval(() => {
      this.render();
    }, 1000);
  }

  public stop(): void {
    if (this.subscriptionId !== null) {
      this.connection.removeOnLogsListener(this.subscriptionId);
      this.subscriptionId = null;
    }
    if (this.renderInterval) {
      clearInterval(this.renderInterval);
      this.renderInterval = null;
    }
  }

  public addEvent(event: DashboardEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS);
    }
    this.render();
  }

  public addAnnotation(text: string): void {
    this.addEvent({
      timestamp: new Date(),
      type: "annotation",
      icon: "\u{1F3AC}",
      title: "DEMO",
      lines: [text],
    });
  }

  // ────────────────────────────────────────────────────
  //  Log Processing
  // ────────────────────────────────────────────────────

  private processLogs(logs: string[]): void {
    try {
      for (const event of this.eventParser.parseLogs(logs)) {
        this.handleEvent(event);
      }
    } catch {
      // silently ignore parse errors
    }
  }

  private handleEvent(event: { name: string; data: any }): void {
    const now = new Date();
    const d = event.data;

    switch (event.name) {
      case "agentRegistered": {
        this.agentCount++;
        if (d.name) {
          this.agentNames.set(d.owner.toBase58(), d.name);
          this.agentNames.set(d.agent.toBase58(), d.name);
        }
        this.addEvent({
          timestamp: now,
          type: "agentRegistered",
          icon: "\u{1F916}",
          title: "AGENT REGISTERED",
          lines: [
            `Name: ${chalk.white.bold(d.name)}  Owner: ${chalk.gray(truncatePubkey(d.owner))}`,
            `Price: ${chalk.yellowBright(lamportsToSol(d.priceLamports) + " SOL")}  PDA: ${chalk.gray(truncatePubkey(d.agent))}`,
          ],
        });
        break;
      }

      case "agentUpdated": {
        this.addEvent({
          timestamp: now,
          type: "agentUpdated",
          icon: "\u{1F504}",
          title: "AGENT UPDATED",
          lines: [
            `Name: ${chalk.white.bold(d.name)}  Owner: ${chalk.gray(truncatePubkey(d.owner))}`,
          ],
        });
        break;
      }

      case "jobCreated": {
        this.jobCount++;
        const amount = d.escrowAmount || d.escrowLamports;
        this.totalEscrow += amount.toNumber();
        const clientName = this.resolveName(d.client);
        const agentName = this.resolveName(d.agent);
        const tokenLabel = d.tokenMint
          ? chalk.cyan(` [SPL: ${truncatePubkey(d.tokenMint)}]`)
          : "";
        const autoRelease = d.autoReleaseAt
          ? chalk.gray(`Auto-release: ${new Date(d.autoReleaseAt.toNumber() * 1000).toLocaleTimeString()}`)
          : chalk.gray("Auto-release: No");
        this.addEvent({
          timestamp: now,
          type: "jobCreated",
          icon: "\u{1F4B0}",
          title: "JOB CREATED",
          lines: [
            `Client: ${chalk.white(clientName)} \u{2192} Agent: ${chalk.white.bold(agentName)}${tokenLabel}`,
            `Escrow: ${chalk.yellowBright("+" + lamportsToSol(amount) + " SOL")}  ${autoRelease}`,
          ],
        });
        break;
      }

      case "jobCompleted": {
        const agentName = this.resolveName(d.agent);
        this.addEvent({
          timestamp: now,
          type: "jobCompleted",
          icon: "\u{1F916}",
          title: "JOB COMPLETED",
          lines: [
            `Agent: ${chalk.cyan.bold(agentName)} delivered result`,
            `URI: ${chalk.gray(d.resultUri.length > 40 ? d.resultUri.slice(0, 40) + "..." : d.resultUri)}`,
          ],
        });
        break;
      }

      case "jobDelegated": {
        const parentAgent = this.resolveName(d.delegatingAgent);
        const subAgent = this.resolveName(d.subAgent);
        this.addEvent({
          timestamp: now,
          type: "jobDelegated",
          icon: "\u{1F500}",
          title: "DELEGATION",
          lines: [
            `${chalk.yellow.bold(parentAgent)} \u{2192} ${chalk.yellow.bold(subAgent)}`,
            `${chalk.yellowBright("-" + lamportsToSol(d.amount) + " SOL")} (parent) \u{2192} ${chalk.yellowBright("+" + lamportsToSol(d.amount) + " SOL")} (child)`,
          ],
        });
        break;
      }

      case "paymentReleased": {
        this.totalEscrow -= d.amount.toNumber();
        const agentName = this.resolveName(d.agent);
        const tokenLabel = d.tokenMint
          ? chalk.cyan(` [SPL]`)
          : "";
        this.addEvent({
          timestamp: now,
          type: "paymentReleased",
          icon: "\u{1F4B8}",
          title: "PAYMENT RELEASED",
          lines: [
            `${chalk.yellowBright("+" + lamportsToSol(d.amount) + " SOL")} \u{2192} ${chalk.magenta.bold(agentName)}${tokenLabel}`,
            `Auto-released: ${d.autoReleased ? chalk.green("Yes") : chalk.gray("No")}`,
          ],
        });
        break;
      }

      case "agentRated": {
        const agentName = this.resolveName(d.agent);
        const score = d.score;
        const stars = "\u{2B50}".repeat(score);
        const avg = (d.newAvgX100.toNumber() / 100).toFixed(2);
        this.addEvent({
          timestamp: now,
          type: "agentRated",
          icon: "\u{2B50}",
          title: "AGENT RATED",
          lines: [
            `${chalk.blue.bold(agentName)}: ${stars} ${chalk.white(score + "/5")}`,
            `Average rating: ${chalk.yellowBright(avg + "/5.00")}`,
          ],
        });
        break;
      }

      case "disputeRaised": {
        this.addEvent({
          timestamp: now,
          type: "disputeRaised",
          icon: "\u{1F6A8}",
          title: "DISPUTE RAISED",
          lines: [
            `Job: ${chalk.gray(truncatePubkey(d.job))}`,
            `Raised by: ${chalk.red.bold(this.resolveName(d.raisedBy))}`,
          ],
        });
        break;
      }

      case "disputeResolved": {
        this.addEvent({
          timestamp: now,
          type: "disputeResolved",
          icon: "\u{2696}\u{FE0F}",
          title: "DISPUTE RESOLVED",
          lines: [
            `Job: ${chalk.gray(truncatePubkey(d.job))}`,
            `Refund: ${chalk.yellowBright(lamportsToSol(d.refundAmount || d.refundLamports) + " SOL")}`,
            `Resolved by: ${chalk.gray(truncatePubkey(d.resolvedBy))}`,
          ],
        });
        break;
      }

      case "jobCancelled": {
        const refund = d.refundAmount || d.refundLamports;
        this.addEvent({
          timestamp: now,
          type: "jobCancelled",
          icon: "\u{274C}",
          title: "JOB CANCELLED",
          lines: [
            `Client: ${chalk.gray(this.resolveName(d.client))}`,
            `Refund: ${chalk.yellowBright(lamportsToSol(refund) + " SOL")}`,
          ],
        });
        break;
      }

      case "agentStaked": {
        this.totalStaked += d.amount.toNumber();
        const agentName = this.resolveName(d.agent);
        this.addEvent({
          timestamp: now,
          type: "agentStaked",
          icon: "\u{1F512}",
          title: "AGENT STAKED",
          lines: [
            `Agent: ${chalk.green.bold(agentName)}`,
            `Staked: ${chalk.yellowBright("+" + lamportsToSol(d.amount) + " SOL")}  Total: ${chalk.white(lamportsToSol(d.totalStake) + " SOL")}`,
          ],
        });
        break;
      }

      case "agentUnstaked": {
        this.totalStaked -= d.amount.toNumber();
        const agentName = this.resolveName(d.agent);
        this.addEvent({
          timestamp: now,
          type: "agentUnstaked",
          icon: "\u{1F513}",
          title: "AGENT UNSTAKED",
          lines: [
            `Agent: ${chalk.yellow.bold(agentName)}`,
            `Withdrawn: ${chalk.yellowBright("-" + lamportsToSol(d.amount) + " SOL")}  Remaining: ${chalk.white(lamportsToSol(d.remainingStake) + " SOL")}`,
          ],
        });
        break;
      }

      case "stakeSlashed": {
        const agentName = this.resolveName(d.agent);
        this.addEvent({
          timestamp: now,
          type: "stakeSlashed",
          icon: "\u{1F525}",
          title: "STAKE SLASHED",
          lines: [
            `Agent: ${chalk.red.bold(agentName)}  Job: ${chalk.gray(truncatePubkey(d.job))}`,
            `Slashed: ${chalk.red("-" + lamportsToSol(d.slashAmount) + " SOL")}  Remaining: ${chalk.white(lamportsToSol(d.remainingStake) + " SOL")}`,
          ],
        });
        break;
      }
    }
  }

  // ────────────────────────────────────────────────────
  //  Rendering
  // ────────────────────────────────────────────────────

  private render(): void {
    const W = BOX_WIDTH;
    const inner = W - 6;
    const output: string[] = [];

    const boxLine = (content: string): string => {
      const stripped = content.replace(/\u001b\[[0-9;]*m/g, "");
      const realLen = stripped.length;
      const remaining = inner - realLen;
      if (remaining < 0) {
        return `\u{2551}  ${content}  \u{2551}`;
      }
      return `\u{2551}  ${content}${" ".repeat(remaining)}  \u{2551}`;
    };

    const emptyLine = (): string => {
      return `\u{2551}  ${" ".repeat(inner)}  \u{2551}`;
    };

    const uptime = Math.floor(
      (Date.now() - this.startTime.getTime()) / 1000
    );
    const uptimeStr = `${Math.floor(uptime / 60)}m ${uptime % 60}s`;

    output.push(
      chalk.cyan(`\u{2554}${"═".repeat(W - 2)}\u{2557}`)
    );

    output.push(
      chalk.cyan(
        boxLine(
          `${chalk.white.bold("\u{1FAA6}  AGENT PROTOCOL v2")} ${chalk.gray("\u{2014} Live Economy Dashboard")}`
        )
      )
    );
    output.push(
      chalk.cyan(
        boxLine(
          `${chalk.gray("Program:")} ${chalk.white(truncatePubkey(PROGRAM_ID))}  ${chalk.gray("|")}  ${chalk.gray("Network:")} ${chalk.green("devnet")}  ${chalk.gray("|")}  ${chalk.gray("Agents:")} ${chalk.yellowBright(String(this.agentCount))}`
        )
      )
    );
    output.push(
      chalk.cyan(
        boxLine(
          `${chalk.gray("Jobs:")} ${chalk.yellowBright(String(this.jobCount))}  ${chalk.gray("|")}  ${chalk.gray("Staked:")} ${chalk.yellowBright(lamportsToSol(this.totalStaked) + " SOL")}  ${chalk.gray("|")}  ${chalk.gray("Uptime:")} ${chalk.white(uptimeStr)}`
        )
      )
    );

    output.push(
      chalk.cyan(`\u{2560}${"═".repeat(W - 2)}\u{2563}`)
    );

    if (this.events.length === 0) {
      output.push(emptyLine());
      output.push(
        chalk.cyan(
          boxLine(
            chalk.gray.italic("  Waiting for on-chain events...")
          )
        )
      );
      output.push(emptyLine());
      output.push(
        chalk.cyan(
          boxLine(
            chalk.gray("  Listening to program: " + PROGRAM_ID.toBase58())
          )
        )
      );
      output.push(emptyLine());
    } else {
      output.push(emptyLine());

      for (const evt of this.events) {
        const time = chalk.gray(`[${formatTime(evt.timestamp)}]`);
        const titleColor = this.getTitleColor(evt.type);
        const header = `${time} ${evt.icon} ${titleColor(evt.title)}`;

        output.push(chalk.cyan(boxLine(header)));

        for (const line of evt.lines) {
          output.push(
            chalk.cyan(boxLine(`             ${line}`))
          );
        }

        output.push(emptyLine());
      }
    }

    output.push(
      chalk.cyan(`\u{255A}${"═".repeat(W - 2)}\u{255D}`)
    );

    output.push(
      chalk.gray(
        `  Press Ctrl+C to exit  |  ${new Date().toLocaleTimeString("en-US", { hour12: false })}`
      )
    );

    process.stdout.write("\x1B[2J\x1B[H");
    process.stdout.write(output.join("\n") + "\n");
  }

  private getTitleColor(
    type: string
  ): (s: string) => string {
    switch (type) {
      case "agentRegistered":
        return chalk.green.bold;
      case "agentUpdated":
        return chalk.green;
      case "jobCreated":
        return chalk.green.bold;
      case "jobCompleted":
        return chalk.cyan.bold;
      case "jobDelegated":
        return chalk.yellow.bold;
      case "paymentReleased":
        return chalk.magenta.bold;
      case "agentRated":
        return chalk.blue.bold;
      case "disputeRaised":
        return chalk.red.bold;
      case "disputeResolved":
        return chalk.bold;
      case "jobCancelled":
        return chalk.red;
      case "agentStaked":
        return chalk.green.bold;
      case "agentUnstaked":
        return chalk.yellow;
      case "stakeSlashed":
        return chalk.red.bold;
      case "annotation":
        return chalk.whiteBright.bold;
      default:
        return chalk.white;
    }
  }
}

export default Dashboard;
