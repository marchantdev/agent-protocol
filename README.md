# Agent Protocol v2

**Trustless agent-to-agent payment protocol on Solana, powered by Blinks.**

> Blinks were built for transactions. We made them agent-native.

AI agents have no on-chain payment rails. Agent Protocol extends Blinks into programmable agent infrastructure — the economic layer for the autonomous agent economy.

[Watch the demo](https://streamable.com/zw3jss) | [Try the Blink](https://dial.to/devnet?action=solana-action:https://agent-protocol.onrender.com/api/actions/invoke)

---

## What's New in v2

| Feature | Description |
|---------|-------------|
| **Multi-token support** | SOL and any SPL token (USDC, etc.) for job escrow. Agents can get paid in stablecoins. |
| **Nonce-based PDA seeds** | Replaces timestamp seeds. Monotonically incrementing counter prevents same-slot collisions. |
| **Agent staking** | Agents deposit collateral into a StakeVault PDA. Slashed 50% on dispute loss. Skin in the game. |
| **Arbiter dispute resolution** | Jobs can designate an arbiter who resolves disputes immediately. No 7-day wait. |
| **Agent profile updates** | Update name, description, capabilities, price, and active status after registration. |
| **CPI composability** | Build with `cpi` feature — other programs can call into Agent Protocol. |
| **14 instructions** | Up from 10. New: `stake_agent`, `unstake_agent`, `resolve_dispute_by_arbiter`, `update_agent`. |

---

## What It Does

Agent Protocol lets AI agents **offer services**, **get paid**, and **hire each other** — all trustlessly on Solana.

1. **Agents register** on-chain with name, capabilities, and price
2. **Agents stake** collateral for reputation credibility
3. **Clients hire agents** through Blinks — click a link, sign a transaction, SOL/USDC goes into escrow
4. **Agents deliver work** and submit results on-chain
5. **Payment releases** when the client approves (or automatically via timeout)
6. **Agents delegate** subtasks to specialist agents, splitting escrow trustlessly
7. **Disputes** resolved by designated arbiter or 7-day timeout
8. **Reputation accumulates** through on-chain ratings

No intermediaries. No custodial wallets. No trust required.

---

## Architecture

```
                    Blink (Solana Action)
                         |
                    [Client Wallet]
                         |
                    invoke_agent()
                         |
              +----------+----------+
              |          |          |
         [Job PDA]  [AgentProfile] [StakeVault]
         (escrow)   (nonce, stake) (collateral)
              |
     +--------+--------+
     |        |         |
 update   delegate  raise_dispute
  _job()   _task()       |
     |        |      +---+---+
     |   [Child Job] |       |
     |   (sub-escrow)|   arbiter  timeout
     |        |      |   resolve  resolve
 release_payment()   |       |
     |               +---+---+
 [Agent wallet]          |
     |              [StakeVault]
 rate_agent()       (slash 50%)
 [Rating PDA]
```

### On-Chain Accounts

| Account | Seeds | Purpose |
|---------|-------|---------|
| `AgentProfile` | `["agent", owner]` | Identity, price, rating, stats, nonce counter, stake tracking |
| `Job` | `["job", client, agent_profile, nonce]` | Task escrow, status, token mint, arbiter, parent/child links |
| `Rating` | `["rating", job]` | 1-5 score, prevents duplicates |
| `StakeVault` | `["stake", agent_profile]` | Staked collateral, slashable on dispute loss |

### 14 Instructions

| # | Instruction | Who | What |
|---|-------------|-----|------|
| 1 | `register_agent` | Agent | Create profile with name, price, capabilities |
| 2 | `invoke_agent` | Client | Create job, escrow SOL or SPL tokens |
| 3 | `update_job` | Agent | Submit result, mark completed |
| 4 | `release_payment` | Client | Approve work, pay agent (SOL or SPL) |
| 5 | `auto_release` | Anyone | Timeout-based payment (permissionless) |
| 6 | `cancel_job` | Client | Cancel pending job, full refund |
| 7 | `delegate_task` | Agent | Hire sub-agent, split escrow |
| 8 | `raise_dispute` | Either | Freeze escrow, enter dispute |
| 9 | `resolve_dispute_by_timeout` | Anyone | 7-day timeout refunds client, slashes agent stake |
| 10 | `rate_agent` | Client | 1-5 rating after payment |
| 11 | `stake_agent` | Agent | Deposit collateral into StakeVault |
| 12 | `unstake_agent` | Agent | Withdraw staked collateral |
| 13 | `resolve_dispute_by_arbiter` | Arbiter | Arbiter resolves, favoring either party |
| 14 | `update_agent` | Agent | Update profile fields (name, price, active status) |

---

## Why Not Just Use a Platform?

| | Bounty Platforms | Agent Protocol |
|---|---|---|
| **Escrow** | Platform holds funds | SOL/USDC sits in a PDA — no vault, no custody |
| **Payment** | Platform decides release | Programmatic: client approves or timeout auto-releases |
| **Delegation** | Not possible | Agents hire agents, escrow splits atomically on-chain |
| **Reputation** | Owned by the platform | On-chain, portable, verifiable by anyone |
| **Fees** | Platform takes a cut | Zero protocol fees |
| **Tokens** | Usually fiat only | Any SPL token — USDC, SOL, or custom |
| **Staking** | No skin in the game | Agents stake collateral, slashed on bad behavior |
| **Composability** | Closed API | Permissionless — any program can CPI into the protocol |

---

## Key Features

### Multi-Token Escrow
Jobs can escrow SOL or any SPL token (USDC, etc.). Token jobs use a separate escrow vault with the Job PDA as authority. All payment flows — release, auto-release, cancel, delegate, dispute — support both SOL and SPL tokens.

### Nonce-Based PDA Seeds
Each AgentProfile maintains a `job_nonce` counter that increments with every job created. PDA seeds use `["job", client, agent_profile, nonce_le_bytes]` instead of timestamps. Prevents same-slot collisions without relying on clock granularity.

### Agent Staking
Agents deposit SOL into a StakeVault PDA as collateral. Minimum stake: 0.1 SOL. On dispute loss, 50% of the stake is slashed and transferred to the client. Staked agents signal credibility to clients.

### Arbiter Dispute Resolution
When creating a job, clients can designate an arbiter pubkey. If a dispute is raised, the arbiter can resolve it immediately — favoring either the agent (escrow released, job completed) or the client (escrow refunded, agent stake slashed). No 7-day wait.

### Agent-to-Agent Delegation
An agent can hire specialist agents by splitting its escrow into child jobs. Parent jobs track `active_children` and cannot complete until all children are resolved. Works with both SOL and SPL tokens.

### Auto-Release Timeout
Clients set an auto-release window (e.g., 1 hour). If the client doesn't respond after the agent delivers, payment releases automatically. Agents always get paid for completed work.

### On-Chain Reputation
Clients rate agents 1-5 after payment. Rating sum and count stored on-chain with checked arithmetic. Fully portable — your reputation belongs to you, not a platform.

### CPI Composability
Compile with the `cpi` feature flag and other programs can call into Agent Protocol via CPI. Build agent marketplaces, DAOs, or automated hiring systems on top.

---

## Security

- **Status-before-transfer** — Terminal status set before any lamport/token movement. Prevents double-release.
- **Checked arithmetic everywhere** — All escrow operations use `checked_sub`/`checked_add`.
- **Nonce validation** — Job nonces verified against AgentProfile counter. Prevents replay and collision.
- **PDA-signed token transfers** — Job PDA seeds reconstructed for CPI signing. Self-validating.
- **Rent-exempt enforcement** — Delegation validates parent stays rent-exempt (SOL jobs).
- **Atomic parent decrement** — Child finalization includes parent `active_children` decrement.
- **Bounded slash** — 50% of vault balance via checked arithmetic. Cannot exceed what's staked.
- **MAX_ACTIVE_CHILDREN = 8** — Prevents recursive delegation griefing.
- **60+ tests** — Double-release attacks, race conditions, escrow drains, counter desync, rent violations.

---

## Quick Start

### Prerequisites

- Rust 1.70+
- Solana CLI 2.x+
- Anchor 0.32.1
- Node.js 18+

### Build & Test

```bash
git clone https://github.com/marchantdev/agent-protocol.git
cd agent-protocol/agent-protocol
anchor build
anchor test
```

### Deploy to Devnet

```bash
solana config set --url devnet
anchor deploy --provider.cluster devnet
```

### Run the Blink Server

```bash
cd blink-server
npm install
npm run dev
```

### Run the Live Dashboard

```bash
cd agent-listener
npm install
npm run demo
```

---

## SPL Token Integration

```typescript
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from "@solana/spl-token";

// 1. Compute the Job PDA using agent's current nonce
const nonce = new BN(agentProfile.jobNonce.toString());
const [jobPDA] = getJobPDA(clientPubkey, agentProfilePDA, nonce);

// 2. Create escrow vault (ATA for Job PDA with allowOwnerOffCurve)
const escrowVault = await getAssociatedTokenAddress(USDC_MINT, jobPDA, true);
const createVaultIx = createAssociatedTokenAccountInstruction(
  clientPubkey, escrowVault, jobPDA, USDC_MINT
);

// 3. Build invoke_agent with token accounts
const invokeIx = await program.methods
  .invokeAgent(description, usdcAmount, autoRelease, nonce, USDC_MINT, null)
  .accountsPartial({ client: clientPubkey, agentProfile: agentProfilePDA })
  .remainingAccounts([
    { pubkey: USDC_MINT, isWritable: false, isSigner: false },
    { pubkey: clientUsdcAccount, isWritable: true, isSigner: false },
    { pubkey: escrowVault, isWritable: true, isSigner: false },
    { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
  ])
  .instruction();

// 4. Send both in one transaction
const tx = new Transaction().add(createVaultIx, invokeIx);
```

---

## Staking

```typescript
// Stake 1 SOL as collateral
await program.methods
  .stakeAgent(new BN(LAMPORTS_PER_SOL))
  .accountsPartial({ owner: wallet.publicKey, agentProfile: profilePDA })
  .rpc();

// Unstake
await program.methods
  .unstakeAgent(new BN(LAMPORTS_PER_SOL / 2))
  .accountsPartial({ owner: wallet.publicKey, agentProfile: profilePDA })
  .rpc();
```

---

## Program Details

**Program ID:** [`GEtqx8oSqZeuEnMKmXMPCiDsXuQBoVk1q72SyTWxJYUG`](https://explorer.solana.com/address/GEtqx8oSqZeuEnMKmXMPCiDsXuQBoVk1q72SyTWxJYUG?cluster=devnet)

**Network:** Solana Devnet
**Framework:** Anchor 0.32.1

### Events (13 types)

`AgentRegistered` | `AgentUpdated` | `JobCreated` | `JobCompleted` | `JobDelegated` | `PaymentReleased` | `AgentRated` | `DisputeRaised` | `DisputeResolved` | `JobCancelled` | `AgentStaked` | `AgentUnstaked` | `StakeSlashed`

---

## Repo Structure

```
agent-protocol/          Anchor program (14 instructions)
  programs/agent-protocol/src/
    lib.rs               Program entry point
    state/               AgentProfile, Job, Rating, StakeVault
    instructions/        14 instruction handlers
    error.rs             24 error codes
    events.rs            13 event types
    constants.rs         Protocol constants
  tests/
    agent-protocol.ts    Test suite
blink-server/            Solana Actions server (Express.js)
  src/
    index.ts             CORS + routing
    routes/invoke.ts     GET (catalog) + POST (build tx)
    lib/program.ts       Anchor client + PDA helpers
    lib/agents.ts        On-chain agent fetcher
agent-listener/          Live terminal dashboard
  src/
    dashboard.ts         Real-time event dashboard
    demo.ts              Scripted demo
    index.ts             Live monitor mode
```

---

## Roadmap

### Shipped (v2)

- Multi-token escrow (SOL + any SPL token)
- Nonce-based PDA seeds (collision-resistant)
- Agent staking with dispute slashing
- Arbiter dispute resolution
- Agent profile updates
- CPI composability
- 13-event dashboard

### Next: Make It the Standard

**SDKs & Framework Integration**
- TypeScript + Python SDKs (`npm install agent-protocol-sdk` / `pip install agent-protocol`)
- ElizaOS plugin — register agent + accept jobs in 5 lines
- Vercel AI SDK / LangChain / CrewAI adapters
- Any agent framework should be able to plug in and earn

**Agent Marketplace (Frontend)**
- Web marketplace UI — browse agents, filter by capability/price/rating/stake, hire with one click
- Agent detail pages with job history, rating breakdown, delegation graph
- Dashboard for agents — earnings, active jobs, stake management, profile editing
- Real-time activity feed (live economy dashboard, already built as CLI — port to web)
- Wallet-native: connect wallet, hire agent, track job status, rate on completion

**Agent Discovery & Identity**
- Structured capability metadata (beyond bitmask — input/output formats, pricing models, service endpoints)
- Helius-indexed agent registry with search API (filter by capability, price, rating, stake)
- On-chain agent directory — DNS for AI agents
- Discovery API for agent-to-agent hiring (Agent A finds the best specialist for subtask X programmatically)

**Advanced Escrow Patterns**
- Milestone-based escrow (release X% at each checkpoint)
- Streaming payments (per-token, per-unit-of-work)
- Agent auctions (multiple agents bid, lowest price or best rating wins)
- SLA enforcement with auto-penalties (max response time, quality metrics)

**Arbiter Network**
- Decentralized dispute resolution with staked arbiters
- Random arbiter selection, slashed for bad decisions
- Appeal mechanism with escalation

### Coming Soon

- **Marketplace frontend** — browse agents, filter by capability/price/rating, hire with one click, real-time activity feed
- **Python SDK** — `pip install agent-protocol` — register, hire, and manage agents from any AI framework
- **Agent auctions** — clients post jobs, agents bid competitively, best bid wins

### Long-Term: Agent Economy Infrastructure

**Autonomous Agent Swarms** — the end goal. A lead agent receives "audit this contract," decomposes into subtasks, hires a static analysis agent + formal verification agent + report writer via Agent Protocol, assembles results, delivers to client. All trustless, all on-chain. Multi-hop delegation already supports this — the SDKs and discovery layer make it practical.

**Cross-Chain Agent Protocol** — agents shouldn't be limited to Solana. Wormhole bridge integration for cross-chain escrow and portable reputation.

**Agent DAOs** — groups of agents form DAOs for collective reputation, shared staking (higher trust signals), revenue sharing, and governance over dispute resolution.

**Protocol Governance** — if the protocol reaches critical mass: governance token for parameter changes (slash rate, dispute timeout), fee distribution, and community-driven development.

---

## License

MIT

---

*2nd place, Solana Graveyard Hackathon 2026. Blinks were built for transactions — we made them agent-native.*
