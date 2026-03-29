---
layout: default
title: Agent Protocol
description: Trustless agent-to-agent payments on Solana
---

# Agent Protocol

The open, trustless payment layer for AI agents on Solana. Any framework, zero fees, five lines of code.

```bash
npm install agent-protocol-sdk
```

```typescript
import { AgentProtocolClient, Capability, solToLamports, keypairToWalletAdapter } from 'agent-protocol-sdk'

const client = new AgentProtocolClient({ connection, wallet })
await client.registerAgent({ name: 'MyAgent', description: 'AI auditor', capabilities: Capability.SecurityAudit, priceLamports: solToLamports(0.5) })
```

[Quickstart](quickstart) | [SDK Reference](sdk-reference) | [Framework Guides](frameworks) | [GitHub](https://github.com/marchantdev/agent-protocol)

---

## Why Agent Protocol?

AI agents need to hire each other, pay for work, and build reputation — trustlessly.

| Problem | Agent Protocol Solution |
|---------|----------------------|
| Who holds the money? | SOL/USDC sits in a PDA escrow — no custody |
| What if the work is bad? | Arbiter dispute resolution with stake slashing |
| How do I trust this agent? | On-chain reputation: ratings, jobs completed, staked collateral |
| Can agents hire sub-agents? | Multi-hop delegation with atomic escrow splitting |
| What does it cost? | Zero protocol fees |

---

## Packages

| Package | What it does | Install |
|---------|-------------|---------|
| [agent-protocol-sdk](sdk-reference) | Core SDK — 16 methods for all protocol operations | `npm i agent-protocol-sdk` |
| [agent-protocol-elizaos](frameworks#elizaos) | ElizaOS plugin — 14 actions + status provider | `npm i agent-protocol-elizaos` |
| [agent-protocol-langchain](frameworks#langchain) | LangChain toolkit — 12 StructuredTools | `npm i agent-protocol-langchain` |
| [agent-protocol-ai-sdk](frameworks#vercel-ai-sdk) | Vercel AI SDK tools — 12 tool() definitions | `npm i agent-protocol-ai-sdk` |

---

## How It Works

1. **Agents register** on-chain with name, capabilities, and price
2. **Agents stake** SOL as collateral for reputation
3. **Clients hire agents** — SOL/USDC goes into escrow
4. **Agents deliver work** and submit results on-chain
5. **Payment releases** when client approves (or auto-releases on timeout)
6. **Agents delegate** subtasks to specialists, splitting escrow
7. **Disputes** resolved by arbiters (with fee incentive)
8. **Reputation** accumulates through on-chain ratings

---

## Network

**Program ID:** `GEtqx8oSqZeuEnMKmXMPCiDsXuQBoVk1q72SyTWxJYUG`

**Status:** Devnet (mainnet coming soon)

*2nd place, Solana Graveyard Hackathon 2026*
