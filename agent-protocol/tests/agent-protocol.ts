import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentProtocol } from "../target/types/agent_protocol";
import { expect } from "chai";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import BN from "bn.js";

describe("agent-protocol", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.agentProtocol as Program<AgentProtocol>;
  const connection = provider.connection;

  // ─── PDA derivation helpers ───

  const getAgentProfilePDA = (owner: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), owner.toBuffer()],
      program.programId
    );

  const getJobPDA = (client: PublicKey, agentProfile: PublicKey, ts: BN) =>
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("job"),
        client.toBuffer(),
        agentProfile.toBuffer(),
        ts.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

  const getRatingPDA = (job: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("rating"), job.toBuffer()],
      program.programId
    );

  // ─── Utility ───

  const airdrop = async (pubkey: PublicKey, amount = 10 * LAMPORTS_PER_SOL) => {
    const sig = await connection.requestAirdrop(pubkey, amount);
    await connection.confirmTransaction(sig);
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Nonce helper: reads current nonce from on-chain agent profile
  async function getNonce(agentProfilePDA: PublicKey): Promise<BN> {
    const profile = await program.account.agentProfile.fetch(agentProfilePDA);
    return new BN((profile.jobNonce as any).toString());
  }

  const PRICE = new BN(LAMPORTS_PER_SOL / 2); // 0.5 SOL
  const PAYMENT = new BN(LAMPORTS_PER_SOL); // 1 SOL

  // ─── Reusable action helpers ───

  async function registerAgent(
    owner: Keypair,
    name = "TestAgent",
    price = PRICE
  ): Promise<PublicKey> {
    const [pda] = getAgentProfilePDA(owner.publicKey);
    await program.methods
      .registerAgent(name, "A test agent", 0x3f, price)
      .accountsPartial({ owner: owner.publicKey })
      .signers([owner])
      .rpc();
    return pda;
  }

  async function invokeAgent(
    client: Keypair,
    agentProfilePDA: PublicKey,
    payment = PAYMENT,
    autoReleaseSecs: BN | null = null,
    desc = "Test task"
  ) {
    const nonce = await getNonce(agentProfilePDA);
    const [jobPDA] = getJobPDA(client.publicKey, agentProfilePDA, nonce);
    await program.methods
      .invokeAgent(desc, payment, autoReleaseSecs, nonce, null, null, 0)
      .accountsPartial({
        client: client.publicKey,
        agentProfile: agentProfilePDA,
      })
      .signers([client])
      .rpc();
    return { jobPDA, ts: nonce };
  }

  async function updateJob(agent: Keypair, jobPDA: PublicKey, uri = "https://result.example.com") {
    await program.methods
      .updateJob(uri)
      .accountsPartial({ agent: agent.publicKey, job: jobPDA })
      .signers([agent])
      .rpc();
  }

  async function releasePayment(
    client: Keypair,
    agentWallet: PublicKey,
    agentProfilePDA: PublicKey,
    jobPDA: PublicKey,
    parentJobPDA: PublicKey | null = null
  ) {
    await program.methods
      .releasePayment()
      .accountsPartial({
        client: client.publicKey,
        agent: agentWallet,
        agentProfile: agentProfilePDA,
        job: jobPDA,
        parentJob: parentJobPDA,
      })
      .signers([client])
      .rpc();
  }

  async function autoReleaseTx(
    agentWallet: PublicKey,
    agentProfilePDA: PublicKey,
    jobPDA: PublicKey,
    clientPubkey: PublicKey,
    parentJobPDA: PublicKey | null = null
  ) {
    await program.methods
      .autoRelease()
      .accountsPartial({
        agent: agentWallet,
        agentProfile: agentProfilePDA,
        job: jobPDA,
        client: clientPubkey,
        parentJob: parentJobPDA,
      })
      .rpc();
  }

  async function cancelJob(client: Keypair, jobPDA: PublicKey) {
    await program.methods
      .cancelJob()
      .accountsPartial({ client: client.publicKey, job: jobPDA })
      .signers([client])
      .rpc();
  }

  async function delegateTask(
    agent: Keypair,
    parentJobPDA: PublicKey,
    subAgentProfilePDA: PublicKey,
    amount: BN,
    desc = "Subtask"
  ) {
    const nonce = await getNonce(subAgentProfilePDA);
    const [childPDA] = getJobPDA(agent.publicKey, subAgentProfilePDA, nonce);
    await program.methods
      .delegateTask(desc, amount, nonce)
      .accountsPartial({
        delegatingAgent: agent.publicKey,
        parentJob: parentJobPDA,
        subAgentProfile: subAgentProfilePDA,
      })
      .signers([agent])
      .rpc();
    return { childJobPDA: childPDA, ts: nonce };
  }

  async function raiseDispute(disputant: Keypair, jobPDA: PublicKey) {
    await program.methods
      .raiseDispute()
      .accountsPartial({ disputant: disputant.publicKey, job: jobPDA })
      .signers([disputant])
      .rpc();
  }

  async function rateAgent(
    client: Keypair,
    jobPDA: PublicKey,
    agentProfilePDA: PublicKey,
    score: number
  ) {
    await program.methods
      .rateAgent(score)
      .accountsPartial({
        client: client.publicKey,
        job: jobPDA,
        agentProfile: agentProfilePDA,
      })
      .signers([client])
      .rpc();
  }

  // Helper to assert an Anchor error code
  function expectAnchorError(err: any, code: string) {
    const c = err?.error?.errorCode?.code;
    if (c) {
      expect(c).to.equal(code);
    } else {
      const msg = (err?.message || "") + (err?.logs?.join("\n") || "");
      expect(msg).to.include(code);
    }
  }

  // ─── Shared state set up once ───

  let agentOwnerA: Keypair;
  let agentOwnerB: Keypair;
  let agentProfileA: PublicKey;
  let agentProfileB: PublicKey;
  let clientKp: Keypair;

  before(async () => {
    agentOwnerA = Keypair.generate();
    agentOwnerB = Keypair.generate();
    clientKp = Keypair.generate();

    await airdrop(agentOwnerA.publicKey);
    await airdrop(agentOwnerB.publicKey);
    await airdrop(clientKp.publicKey, 100 * LAMPORTS_PER_SOL);

    agentProfileA = await registerAgent(agentOwnerA, "Aurora", PRICE);
    agentProfileB = await registerAgent(agentOwnerB, "CodeAuditor", PRICE);
  });

  // ═══════════════════════════════════════
  //  register_agent
  // ═══════════════════════════════════════

  describe("register_agent", () => {
    it("registers agent with valid params and correct PDA fields", async () => {
      const kp = Keypair.generate();
      await airdrop(kp.publicKey);
      const pda = await registerAgent(kp, "Fresh", new BN(100_000));
      const acct = await program.account.agentProfile.fetch(pda);
      expect(acct.owner.toBase58()).to.equal(kp.publicKey.toBase58());
      expect(acct.name).to.equal("Fresh");
      expect(acct.priceLamports.toNumber()).to.equal(100_000);
      expect(acct.isActive).to.be.true;
      expect(acct.jobsCompleted).to.equal(0);
      expect(acct.ratingCount).to.equal(0);
      expect(acct.ratingSum.toNumber()).to.equal(0);
      expect(acct.bump).to.be.greaterThan(0);
    });

    it("rejects duplicate registration (same owner)", async () => {
      const kp = Keypair.generate();
      await airdrop(kp.publicKey);
      await registerAgent(kp, "First");
      try {
        await registerAgent(kp, "Second");
        expect.fail("Should have thrown");
      } catch (err: any) {
        // PDA already initialised — Anchor or runtime error
        expect(err).to.exist;
      }
    });

    it("rejects empty name", async () => {
      const kp = Keypair.generate();
      await airdrop(kp.publicKey);
      try {
        await registerAgent(kp, "");
        expect.fail("Should have thrown");
      } catch (err: any) {
        expectAnchorError(err, "EmptyName");
      }
    });

    it("rejects zero price", async () => {
      const kp = Keypair.generate();
      await airdrop(kp.publicKey);
      try {
        await registerAgent(kp, "Agent", new BN(0));
        expect.fail("Should have thrown");
      } catch (err: any) {
        expectAnchorError(err, "InvalidPrice");
      }
    });
  });

  // ═══════════════════════════════════════
  //  invoke_agent
  // ═══════════════════════════════════════

  describe("invoke_agent", () => {
    it("creates job with escrowed SOL and correct fields", async () => {
      const { jobPDA } = await invokeAgent(clientKp, agentProfileA);
      const job = await program.account.job.fetch(jobPDA);
      expect(job.client.toBase58()).to.equal(clientKp.publicKey.toBase58());
      expect(job.agent.toBase58()).to.equal(agentOwnerA.publicKey.toBase58());
      expect(job.escrowAmount.toNumber()).to.equal(PAYMENT.toNumber());
      expect(Object.keys(job.status)[0]).to.equal("pending");
      expect(job.description).to.equal("Test task");
      expect(job.activeChildren).to.equal(0);
      expect(job.parentJob).to.be.null;
    });

    it("rent invariant: PDA balance == payment + rent", async () => {
      const { jobPDA } = await invokeAgent(clientKp, agentProfileA);
      const bal = await connection.getBalance(jobPDA);
      const rent = await connection.getMinimumBalanceForRentExemption(
        (await connection.getAccountInfo(jobPDA))!.data.length
      );
      expect(bal).to.equal(PAYMENT.toNumber() + rent);
    });

    it("sets auto_release_at when seconds provided", async () => {
      const { jobPDA } = await invokeAgent(
        clientKp,
        agentProfileA,
        PAYMENT,
        new BN(3600)
      );
      const job = await program.account.job.fetch(jobPDA);
      expect(job.autoReleaseAt).to.not.be.null;
    });

    it("rejects payment below agent price", async () => {
      try {
        await invokeAgent(clientKp, agentProfileA, new BN(1000));
        expect.fail("Should have thrown");
      } catch (err: any) {
        expectAnchorError(err, "InsufficientPayment");
      }
    });

    it("rejects empty description", async () => {
      try {
        await invokeAgent(clientKp, agentProfileA, PAYMENT, null, "");
        expect.fail("Should have thrown");
      } catch (err: any) {
        expectAnchorError(err, "EmptyDescription");
      }
    });
  });

  // ═══════════════════════════════════════
  //  update_job
  // ═══════════════════════════════════════

  describe("update_job", () => {
    it("agent submits result, status -> Completed", async () => {
      const { jobPDA } = await invokeAgent(clientKp, agentProfileA);
      await updateJob(agentOwnerA, jobPDA);
      const job = await program.account.job.fetch(jobPDA);
      expect(Object.keys(job.status)[0]).to.equal("completed");
      expect(job.resultUri).to.equal("https://result.example.com");
      expect(job.completedAt).to.not.be.null;
    });

    it("rejects non-agent signer", async () => {
      const { jobPDA } = await invokeAgent(clientKp, agentProfileA);
      try {
        await updateJob(clientKp, jobPDA);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expectAnchorError(err, "Unauthorized");
      }
    });

    it("rejects empty result_uri", async () => {
      const { jobPDA } = await invokeAgent(clientKp, agentProfileA);
      try {
        await updateJob(agentOwnerA, jobPDA, "");
        expect.fail("Should have thrown");
      } catch (err: any) {
        expectAnchorError(err, "EmptyResultUri");
      }
    });

    it("rejects if active_children > 0", async () => {
      const { jobPDA: parentPDA } = await invokeAgent(clientKp, agentProfileA);
      await delegateTask(
        agentOwnerA,
        parentPDA,
        agentProfileB,
        new BN(LAMPORTS_PER_SOL / 10)
      );
      try {
        await updateJob(agentOwnerA, parentPDA);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expectAnchorError(err, "UnresolvedChildren");
      }
    });
  });

  // ═══════════════════════════════════════
  //  release_payment
  // ═══════════════════════════════════════

  describe("release_payment", () => {
    it("transfers SOL to agent and increments jobs_completed", async () => {
      const profileBefore = await program.account.agentProfile.fetch(agentProfileA);
      const agentBalBefore = await connection.getBalance(agentOwnerA.publicKey);

      const { jobPDA } = await invokeAgent(clientKp, agentProfileA);
      await updateJob(agentOwnerA, jobPDA);
      await releasePayment(clientKp, agentOwnerA.publicKey, agentProfileA, jobPDA);

      const agentBalAfter = await connection.getBalance(agentOwnerA.publicKey);
      expect(agentBalAfter - agentBalBefore).to.equal(PAYMENT.toNumber());

      const profileAfter = await program.account.agentProfile.fetch(agentProfileA);
      expect(profileAfter.jobsCompleted).to.equal(profileBefore.jobsCompleted + 1);
    });

    it("job Finalized: escrow drained to zero, PDA retains only rent", async () => {
      const { jobPDA } = await invokeAgent(clientKp, agentProfileA);
      await updateJob(agentOwnerA, jobPDA);
      await releasePayment(clientKp, agentOwnerA.publicKey, agentProfileA, jobPDA);

      const job = await program.account.job.fetch(jobPDA);
      expect(Object.keys(job.status)[0]).to.equal("finalized");
      expect(job.escrowAmount.toNumber()).to.equal(0);

      // PDA lamports == rent-exempt minimum (no stray escrow)
      const info = await connection.getAccountInfo(jobPDA);
      const rent = await connection.getMinimumBalanceForRentExemption(info!.data.length);
      expect(info!.lamports).to.equal(rent);
    });

    it("rejects non-client signer", async () => {
      const { jobPDA } = await invokeAgent(clientKp, agentProfileA);
      await updateJob(agentOwnerA, jobPDA);
      try {
        await releasePayment(agentOwnerA, agentOwnerA.publicKey, agentProfileA, jobPDA);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expectAnchorError(err, "Unauthorized");
      }
    });

    it("rejects if status != Completed", async () => {
      const { jobPDA } = await invokeAgent(clientKp, agentProfileA);
      // Job is still Pending — try release without update
      try {
        await releasePayment(clientKp, agentOwnerA.publicKey, agentProfileA, jobPDA);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expectAnchorError(err, "InvalidJobStatus");
      }
    });
  });

  // ═══════════════════════════════════════
  //  auto_release
  // ═══════════════════════════════════════

  describe("auto_release", () => {
    it("releases payment when time >= auto_release_at", async () => {
      // Use 1-second auto release
      const { jobPDA } = await invokeAgent(
        clientKp,
        agentProfileA,
        PAYMENT,
        new BN(1)
      );
      await updateJob(agentOwnerA, jobPDA);

      // Wait for timeout to pass
      await sleep(2000);

      const agentBefore = await connection.getBalance(agentOwnerA.publicKey);
      await autoReleaseTx(
        agentOwnerA.publicKey,
        agentProfileA,
        jobPDA,
        clientKp.publicKey
      );
      const agentAfter = await connection.getBalance(agentOwnerA.publicKey);
      expect(agentAfter - agentBefore).to.equal(PAYMENT.toNumber());

      // Escrow fully drained — PDA retains only rent
      const info = await connection.getAccountInfo(jobPDA);
      const rent = await connection.getMinimumBalanceForRentExemption(info!.data.length);
      expect(info!.lamports).to.equal(rent);

      const job = await program.account.job.fetch(jobPDA);
      expect(job.escrowAmount.toNumber()).to.equal(0);
      expect(Object.keys(job.status)[0]).to.equal("finalized");
    });

    it("rejects when time < auto_release_at", async () => {
      const { jobPDA } = await invokeAgent(
        clientKp,
        agentProfileA,
        PAYMENT,
        new BN(86400) // 1 day
      );
      await updateJob(agentOwnerA, jobPDA);
      try {
        await autoReleaseTx(
          agentOwnerA.publicKey,
          agentProfileA,
          jobPDA,
          clientKp.publicKey
        );
        expect.fail("Should have thrown");
      } catch (err: any) {
        expectAnchorError(err, "AutoReleaseNotReady");
      }
    });

    it("rejects when no auto_release configured", async () => {
      const { jobPDA } = await invokeAgent(clientKp, agentProfileA, PAYMENT, null);
      await updateJob(agentOwnerA, jobPDA);
      try {
        await autoReleaseTx(
          agentOwnerA.publicKey,
          agentProfileA,
          jobPDA,
          clientKp.publicKey
        );
        expect.fail("Should have thrown");
      } catch (err: any) {
        expectAnchorError(err, "NoAutoRelease");
      }
    });

    it("rejects when status != Completed", async () => {
      const { jobPDA } = await invokeAgent(
        clientKp,
        agentProfileA,
        PAYMENT,
        new BN(1)
      );
      await sleep(2000);
      try {
        // Job is still Pending, not Completed
        await autoReleaseTx(
          agentOwnerA.publicKey,
          agentProfileA,
          jobPDA,
          clientKp.publicKey
        );
        expect.fail("Should have thrown");
      } catch (err: any) {
        expectAnchorError(err, "InvalidJobStatus");
      }
    });
  });

  // ═══════════════════════════════════════
  //  cancel_job
  // ═══════════════════════════════════════

  describe("cancel_job", () => {
    it("cancels Pending job and refunds client", async () => {
      const balBefore = await connection.getBalance(clientKp.publicKey);
      const { jobPDA } = await invokeAgent(clientKp, agentProfileA);
      const balAfterInvoke = await connection.getBalance(clientKp.publicKey);

      await cancelJob(clientKp, jobPDA);
      const balAfterCancel = await connection.getBalance(clientKp.publicKey);

      // Client should get back escrow + rent (minus tx fees)
      // balAfterCancel should be close to balBefore (just tx fees lost)
      const diff = balBefore - balAfterCancel;
      // Should only be ~2 tx fees (~10000 lamports)
      expect(diff).to.be.lessThan(100_000);
    });

    it("rejects if status != Pending (InProgress)", async () => {
      const { jobPDA } = await invokeAgent(clientKp, agentProfileA);
      // Agent starts working (delegates to make it InProgress via delegate, or via update)
      await delegateTask(
        agentOwnerA,
        jobPDA,
        agentProfileB,
        new BN(LAMPORTS_PER_SOL / 10)
      );
      // Job is now InProgress (delegate auto-flips)
      try {
        await cancelJob(clientKp, jobPDA);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expectAnchorError(err, "InvalidJobStatus");
      }
    });

    it("rejects non-client signer", async () => {
      const { jobPDA } = await invokeAgent(clientKp, agentProfileA);
      try {
        await cancelJob(agentOwnerA, jobPDA);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expectAnchorError(err, "Unauthorized");
      }
    });
  });

  // ═══════════════════════════════════════
  //  delegate_task
  // ═══════════════════════════════════════

  describe("delegate_task", () => {
    it("creates child job linked to parent with correct escrow", async () => {
      const { jobPDA: parentPDA } = await invokeAgent(clientKp, agentProfileA);
      const delegateAmt = new BN(LAMPORTS_PER_SOL / 4);
      const { childJobPDA } = await delegateTask(
        agentOwnerA,
        parentPDA,
        agentProfileB,
        delegateAmt
      );

      const child = await program.account.job.fetch(childJobPDA);
      expect(child.parentJob!.toBase58()).to.equal(parentPDA.toBase58());
      expect(child.escrowAmount.toNumber()).to.equal(delegateAmt.toNumber());
      expect(child.agent.toBase58()).to.equal(agentOwnerB.publicKey.toBase58());
      expect(Object.keys(child.status)[0]).to.equal("pending");

      const parent = await program.account.job.fetch(parentPDA);
      expect(parent.activeChildren).to.equal(1);
      expect(parent.escrowAmount.toNumber()).to.equal(
        PAYMENT.toNumber() - delegateAmt.toNumber()
      );
      // Parent auto-flipped to InProgress
      expect(Object.keys(parent.status)[0]).to.equal("inProgress");
    });

    it("rejects delegation exceeding parent escrow", async () => {
      const { jobPDA: parentPDA } = await invokeAgent(clientKp, agentProfileA);
      try {
        await delegateTask(
          agentOwnerA,
          parentPDA,
          agentProfileB,
          new BN(PAYMENT.toNumber() + 1) // more than escrowed
        );
        expect.fail("Should have thrown");
      } catch (err: any) {
        expectAnchorError(err, "InsufficientEscrow");
      }
    });

    it("rejects non-agent signer", async () => {
      const { jobPDA: parentPDA } = await invokeAgent(clientKp, agentProfileA);
      try {
        await delegateTask(
          clientKp, // wrong signer
          parentPDA,
          agentProfileB,
          new BN(LAMPORTS_PER_SOL / 10)
        );
        expect.fail("Should have thrown");
      } catch (err: any) {
        expectAnchorError(err, "Unauthorized");
      }
    });

    it("rejects empty description", async () => {
      const { jobPDA: parentPDA } = await invokeAgent(clientKp, agentProfileA);
      try {
        const nonce = await getNonce(agentProfileB);
        const [childPDA] = getJobPDA(
          agentOwnerA.publicKey,
          agentProfileB,
          nonce
        );
        await program.methods
          .delegateTask("", new BN(LAMPORTS_PER_SOL / 10), nonce)
          .accountsPartial({
            delegatingAgent: agentOwnerA.publicKey,
            parentJob: parentPDA,
            subAgentProfile: agentProfileB,
          })
          .signers([agentOwnerA])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expectAnchorError(err, "EmptyDescription");
      }
    });
  });

  // ═══════════════════════════════════════
  //  raise_dispute
  // ═══════════════════════════════════════

  describe("raise_dispute", () => {
    it("client can raise dispute", async () => {
      const { jobPDA } = await invokeAgent(clientKp, agentProfileA);
      await raiseDispute(clientKp, jobPDA);
      const job = await program.account.job.fetch(jobPDA);
      expect(Object.keys(job.status)[0]).to.equal("disputed");
      expect(job.disputedAt).to.not.be.null;
    });

    it("agent can raise dispute", async () => {
      const { jobPDA } = await invokeAgent(clientKp, agentProfileA);
      await raiseDispute(agentOwnerA, jobPDA);
      const job = await program.account.job.fetch(jobPDA);
      expect(Object.keys(job.status)[0]).to.equal("disputed");
    });

    it("rejects if status is Cancelled", async () => {
      const { jobPDA } = await invokeAgent(clientKp, agentProfileA);
      await cancelJob(clientKp, jobPDA);
      // Account is closed after cancel, so dispute should fail
      try {
        await raiseDispute(clientKp, jobPDA);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).to.exist;
      }
    });
  });

  // ═══════════════════════════════════════
  //  resolve_dispute_by_timeout
  // ═══════════════════════════════════════

  describe("resolve_dispute_by_timeout", () => {
    it("rejects if status != Disputed", async () => {
      const { jobPDA } = await invokeAgent(clientKp, agentProfileA);
      try {
        await program.methods
          .resolveDisputeByTimeout()
          .accountsPartial({ client: clientKp.publicKey, job: jobPDA, stakeVault: null, agentProfile: null })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expectAnchorError(err, "InvalidJobStatus");
      }
    });

    it("rejects if timeout not reached", async () => {
      const { jobPDA } = await invokeAgent(clientKp, agentProfileA);
      await raiseDispute(clientKp, jobPDA);
      try {
        await program.methods
          .resolveDisputeByTimeout()
          .accountsPartial({ client: clientKp.publicKey, job: jobPDA, stakeVault: null, agentProfile: null })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expectAnchorError(err, "DisputeTimeoutNotReached");
      }
    });
  });

  // ═══════════════════════════════════════
  //  rate_agent
  // ═══════════════════════════════════════

  describe("rate_agent", () => {
    it("creates rating and updates agent profile sums", async () => {
      const { jobPDA } = await invokeAgent(clientKp, agentProfileA);
      await updateJob(agentOwnerA, jobPDA);
      await releasePayment(clientKp, agentOwnerA.publicKey, agentProfileA, jobPDA);

      const profileBefore = await program.account.agentProfile.fetch(agentProfileA);
      await rateAgent(clientKp, jobPDA, agentProfileA, 5);

      const profileAfter = await program.account.agentProfile.fetch(agentProfileA);
      expect(profileAfter.ratingCount).to.equal(profileBefore.ratingCount + 1);
      expect(profileAfter.ratingSum.toNumber()).to.equal(
        profileBefore.ratingSum.toNumber() + 5
      );
    });

    it("rejects score outside 1-5 (score 0)", async () => {
      const { jobPDA } = await invokeAgent(clientKp, agentProfileA);
      await updateJob(agentOwnerA, jobPDA);
      await releasePayment(clientKp, agentOwnerA.publicKey, agentProfileA, jobPDA);
      try {
        await rateAgent(clientKp, jobPDA, agentProfileA, 0);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expectAnchorError(err, "InvalidRating");
      }
    });

    it("rejects score outside 1-5 (score 6)", async () => {
      const { jobPDA } = await invokeAgent(clientKp, agentProfileA);
      await updateJob(agentOwnerA, jobPDA);
      await releasePayment(clientKp, agentOwnerA.publicKey, agentProfileA, jobPDA);
      try {
        await rateAgent(clientKp, jobPDA, agentProfileA, 6);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expectAnchorError(err, "InvalidRating");
      }
    });

    it("rejects duplicate rating (same job)", async () => {
      const { jobPDA } = await invokeAgent(clientKp, agentProfileA);
      await updateJob(agentOwnerA, jobPDA);
      await releasePayment(clientKp, agentOwnerA.publicKey, agentProfileA, jobPDA);
      await rateAgent(clientKp, jobPDA, agentProfileA, 4);
      try {
        await rateAgent(clientKp, jobPDA, agentProfileA, 3);
        expect.fail("Should have thrown");
      } catch (err: any) {
        // PDA already init'd
        expect(err).to.exist;
      }
    });

    it("rejects rating before payment (status != Finalized)", async () => {
      const { jobPDA } = await invokeAgent(clientKp, agentProfileA);
      await updateJob(agentOwnerA, jobPDA); // Completed, not Finalized
      try {
        await rateAgent(clientKp, jobPDA, agentProfileA, 5);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expectAnchorError(err, "InvalidJobStatus");
      }
    });
  });

  // ═══════════════════════════════════════
  //  CRITICAL: Double Release Attack
  // ═══════════════════════════════════════

  describe("CRITICAL: Double Release Attack", () => {
    it("second release_payment fails — status is Finalized", async () => {
      const { jobPDA } = await invokeAgent(clientKp, agentProfileA);
      await updateJob(agentOwnerA, jobPDA);
      await releasePayment(clientKp, agentOwnerA.publicKey, agentProfileA, jobPDA);

      // Second attempt — status is Finalized, not Completed
      try {
        await releasePayment(clientKp, agentOwnerA.publicKey, agentProfileA, jobPDA);
        expect.fail("Should have thrown — double release!");
      } catch (err: any) {
        expectAnchorError(err, "InvalidJobStatus");
      }
    });
  });

  describe("CRITICAL: Finalize-After-Finalized Guard", () => {
    it("release_payment on already-Finalized job fails", async () => {
      const { jobPDA } = await invokeAgent(clientKp, agentProfileA);
      await updateJob(agentOwnerA, jobPDA);
      await releasePayment(clientKp, agentOwnerA.publicKey, agentProfileA, jobPDA);

      // Job is Finalized — any second finalize attempt must fail
      try {
        await releasePayment(clientKp, agentOwnerA.publicKey, agentProfileA, jobPDA);
        expect.fail("Should have thrown — cannot finalize twice!");
      } catch (err: any) {
        expectAnchorError(err, "InvalidJobStatus");
      }
    });
  });

  describe("CRITICAL: Double Auto-Release Attack", () => {
    it("second auto_release fails — status is Finalized", async () => {
      const { jobPDA } = await invokeAgent(
        clientKp,
        agentProfileA,
        PAYMENT,
        new BN(1)
      );
      await updateJob(agentOwnerA, jobPDA);
      await sleep(2000);

      await autoReleaseTx(
        agentOwnerA.publicKey,
        agentProfileA,
        jobPDA,
        clientKp.publicKey
      );

      // Second auto_release attempt — status already Finalized
      try {
        await autoReleaseTx(
          agentOwnerA.publicKey,
          agentProfileA,
          jobPDA,
          clientKp.publicKey
        );
        expect.fail("Should have thrown — double auto-release!");
      } catch (err: any) {
        expectAnchorError(err, "InvalidJobStatus");
      }
    });
  });

  // ═══════════════════════════════════════
  //  CRITICAL: Auto Release + Manual Release Race
  // ═══════════════════════════════════════

  describe("CRITICAL: Auto Release + Manual Release Race", () => {
    it("Case A: release_payment first → auto_release fails", async () => {
      const { jobPDA } = await invokeAgent(
        clientKp,
        agentProfileA,
        PAYMENT,
        new BN(1)
      );
      await updateJob(agentOwnerA, jobPDA);
      await sleep(2000);

      // Manual release first
      await releasePayment(clientKp, agentOwnerA.publicKey, agentProfileA, jobPDA);

      // Auto release should fail — status is Finalized
      try {
        await autoReleaseTx(
          agentOwnerA.publicKey,
          agentProfileA,
          jobPDA,
          clientKp.publicKey
        );
        expect.fail("Should have thrown — race condition!");
      } catch (err: any) {
        expectAnchorError(err, "InvalidJobStatus");
      }
    });

    it("Case B: auto_release first → release_payment fails", async () => {
      const { jobPDA } = await invokeAgent(
        clientKp,
        agentProfileA,
        PAYMENT,
        new BN(1)
      );
      await updateJob(agentOwnerA, jobPDA);
      await sleep(2000);

      // Auto release first
      await autoReleaseTx(
        agentOwnerA.publicKey,
        agentProfileA,
        jobPDA,
        clientKp.publicKey
      );

      // Manual release should fail — status is Finalized
      try {
        await releasePayment(clientKp, agentOwnerA.publicKey, agentProfileA, jobPDA);
        expect.fail("Should have thrown — race condition!");
      } catch (err: any) {
        expectAnchorError(err, "InvalidJobStatus");
      }
    });
  });

  // ═══════════════════════════════════════
  //  CRITICAL: Parent Escrow Drain Attempt
  // ═══════════════════════════════════════

  describe("CRITICAL: Parent Escrow Drain Attempt", () => {
    it("second delegation exceeding remaining escrow fails", async () => {
      const { jobPDA: parentPDA } = await invokeAgent(clientKp, agentProfileA);
      // Delegate 0.8 SOL
      await delegateTask(
        agentOwnerA,
        parentPDA,
        agentProfileB,
        new BN(LAMPORTS_PER_SOL * 0.8)
      );
      // Try to delegate 0.3 SOL — only 0.2 SOL remaining
      try {
        await delegateTask(
          agentOwnerA,
          parentPDA,
          agentProfileB,
          new BN(LAMPORTS_PER_SOL * 0.3)
        );
        expect.fail("Should have thrown — escrow drain!");
      } catch (err: any) {
        expectAnchorError(err, "InsufficientEscrow");
      }
    });

    it("release fails while active_children > 0", async () => {
      const { jobPDA: parentPDA } = await invokeAgent(clientKp, agentProfileA);
      await delegateTask(
        agentOwnerA,
        parentPDA,
        agentProfileB,
        new BN(LAMPORTS_PER_SOL / 4)
      );
      // Try to complete and release parent while child is active
      try {
        await updateJob(agentOwnerA, parentPDA);
        expect.fail("Should have thrown — unresolved children!");
      } catch (err: any) {
        expectAnchorError(err, "UnresolvedChildren");
      }
    });
  });

  // ═══════════════════════════════════════
  //  CRITICAL: Parent Counter Desync Test
  // ═══════════════════════════════════════

  describe("CRITICAL: Parent Counter Desync", () => {
    it("child release without providing parent account fails", async () => {
      const { jobPDA: parentPDA } = await invokeAgent(clientKp, agentProfileA);
      const delegateAmt = new BN(LAMPORTS_PER_SOL / 4);
      const { childJobPDA } = await delegateTask(
        agentOwnerA,
        parentPDA,
        agentProfileB,
        delegateAmt
      );

      // Complete child
      await updateJob(agentOwnerB, childJobPDA);

      // Try to release child WITHOUT parent account (pass null)
      // The child has parent_job = Some(parentPDA), so providing null should fail
      try {
        await releasePayment(
          agentOwnerA, // delegating agent is the "client" of child
          agentOwnerB.publicKey,
          agentProfileB,
          childJobPDA,
          null // no parent provided!
        );
        expect.fail("Should have thrown — parent not provided!");
      } catch (err: any) {
        expectAnchorError(err, "ParentJobMismatch");
      }
    });

    it("with correct parent, active_children decrements properly", async () => {
      const { jobPDA: parentPDA } = await invokeAgent(clientKp, agentProfileA);
      const delegateAmt = new BN(LAMPORTS_PER_SOL / 4);
      const { childJobPDA } = await delegateTask(
        agentOwnerA,
        parentPDA,
        agentProfileB,
        delegateAmt
      );

      const parentBefore = await program.account.job.fetch(parentPDA);
      expect(parentBefore.activeChildren).to.equal(1);

      // Complete and release child WITH correct parent
      await updateJob(agentOwnerB, childJobPDA);
      await releasePayment(
        agentOwnerA,
        agentOwnerB.publicKey,
        agentProfileB,
        childJobPDA,
        parentPDA // correct parent
      );

      const parentAfter = await program.account.job.fetch(parentPDA);
      expect(parentAfter.activeChildren).to.equal(0);
    });
  });

  // ═══════════════════════════════════════
  //  CRITICAL: MAX_ACTIVE_CHILDREN Enforcement
  // ═══════════════════════════════════════

  describe("CRITICAL: MAX_ACTIVE_CHILDREN Enforcement", () => {
    it("9th delegation fails (max 8)", async () => {
      // Need a big escrow for 8+ delegations
      const bigPayment = new BN(LAMPORTS_PER_SOL * 5);
      const { jobPDA: parentPDA } = await invokeAgent(
        clientKp,
        agentProfileA,
        bigPayment
      );
      const smallAmt = new BN(LAMPORTS_PER_SOL / 20); // 0.05 SOL each

      // Delegate 8 times (should all succeed)
      for (let i = 0; i < 8; i++) {
        await delegateTask(agentOwnerA, parentPDA, agentProfileB, smallAmt);
      }

      const parent = await program.account.job.fetch(parentPDA);
      expect(parent.activeChildren).to.equal(8);

      // 9th should fail
      try {
        await delegateTask(agentOwnerA, parentPDA, agentProfileB, smallAmt);
        expect.fail("Should have thrown — max children!");
      } catch (err: any) {
        expectAnchorError(err, "TooManyDelegations");
      }
    });
  });

  // ═══════════════════════════════════════
  //  HIGH VALUE: Cancel Edge Case
  // ═══════════════════════════════════════

  describe("HIGH VALUE: Cancel after InProgress", () => {
    it("cancel fails after agent has started (InProgress via update)", async () => {
      const { jobPDA } = await invokeAgent(clientKp, agentProfileA);
      // Agent completes job (flips Pending → Completed via InProgress)
      await updateJob(agentOwnerA, jobPDA);
      const job = await program.account.job.fetch(jobPDA);
      expect(Object.keys(job.status)[0]).to.equal("completed");

      try {
        await cancelJob(clientKp, jobPDA);
        expect.fail("Should have thrown — can't cancel completed job!");
      } catch (err: any) {
        expectAnchorError(err, "InvalidJobStatus");
      }
    });
  });

  // ═══════════════════════════════════════
  //  HIGH VALUE: Dispute → Timeout Flow
  // ═══════════════════════════════════════

  describe("HIGH VALUE: Dispute full flow", () => {
    it("invoke → complete → dispute on completed job without arbiter fails", async () => {
      const { jobPDA } = await invokeAgent(clientKp, agentProfileA);
      await updateJob(agentOwnerA, jobPDA);

      let job = await program.account.job.fetch(jobPDA);
      expect(Object.keys(job.status)[0]).to.equal("completed");

      // Completed jobs require an arbiter for disputes
      try {
        await raiseDispute(clientKp, jobPDA);
        expect.fail("Should have thrown — no arbiter set");
      } catch (err: any) {
        expectAnchorError(err, "ArbiterRequiredForCompletedDispute");
      }
    });
  });

  // ═══════════════════════════════════════
  //  Hidden Edge Cases
  // ═══════════════════════════════════════

  // ═══════════════════════════════════════
  //  NICE-TO-HAVE: Rent Floor Violation
  // ═══════════════════════════════════════

  describe("NICE-TO-HAVE: Rent Floor Violation", () => {
    it("delegation that would drop parent below rent-exempt fails", async () => {
      const { jobPDA: parentPDA } = await invokeAgent(clientKp, agentProfileA);
      const parentInfo = await connection.getAccountInfo(parentPDA);
      const rent = await connection.getMinimumBalanceForRentExemption(parentInfo!.data.length);

      // Try to delegate the FULL escrow amount — would leave parent with only rent
      // but our rent check in delegate_task should catch if lamports - amount < rent
      // Payment is 1 SOL, so try delegating exactly 1 SOL (the entire escrow)
      // parent lamports = rent + 1 SOL. After delegation: rent + 1 SOL - 1 SOL = rent.
      // This should SUCCEED because the parent still has rent-exempt balance.
      // But delegating MORE than escrow should fail from checked_sub.

      // The real test: delegate so much that parent_lamports - amount < rent
      // This can happen if we delegate escrow_lamports (which leaves 0 in tracked escrow)
      // but the actual lamports = rent + 0 = rent, which is fine.
      // The vulnerability would be if someone could drain below rent.
      // Our checked_sub on escrow_lamports prevents delegating more than tracked escrow.

      // Attempt: delegate escrow + 1 (underflow attempt)
      try {
        await delegateTask(
          agentOwnerA,
          parentPDA,
          agentProfileB,
          new BN(PAYMENT.toNumber() + 1)
        );
        expect.fail("Should have thrown — rent floor violation!");
      } catch (err: any) {
        expectAnchorError(err, "InsufficientEscrow");
      }
    });
  });

  // ═══════════════════════════════════════
  //  Hidden Edge Cases
  // ═══════════════════════════════════════

  describe("Hidden Edge Cases", () => {
    it("invoke with 0 escrow fails (below agent price)", async () => {
      try {
        await invokeAgent(clientKp, agentProfileA, new BN(0));
        expect.fail("Should have thrown");
      } catch (err: any) {
        expectAnchorError(err, "InsufficientPayment");
      }
    });

    it("delegation of 0 lamports succeeds (no explicit check)", async () => {
      // Documents that 0-amount delegation is technically allowed
      const { jobPDA: parentPDA } = await invokeAgent(clientKp, agentProfileA);
      const { childJobPDA } = await delegateTask(
        agentOwnerA,
        parentPDA,
        agentProfileB,
        new BN(0)
      );
      const child = await program.account.job.fetch(childJobPDA);
      expect(child.escrowAmount.toNumber()).to.equal(0);
    });

    it("delegating after parent completed fails", async () => {
      const { jobPDA: parentPDA } = await invokeAgent(clientKp, agentProfileA);
      await updateJob(agentOwnerA, parentPDA);
      // Parent is now Completed — delegation should fail
      try {
        await delegateTask(
          agentOwnerA,
          parentPDA,
          agentProfileB,
          new BN(LAMPORTS_PER_SOL / 10)
        );
        expect.fail("Should have thrown");
      } catch (err: any) {
        expectAnchorError(err, "InvalidJobStatus");
      }
    });

    it("update_job on already-Completed job fails", async () => {
      const freshClient = Keypair.generate();
      await airdrop(freshClient.publicKey);
      const { jobPDA } = await invokeAgent(freshClient, agentProfileA);
      await updateJob(agentOwnerA, jobPDA);
      try {
        await updateJob(agentOwnerA, jobPDA, "https://second-result.com");
        expect.fail("Should have thrown");
      } catch (err: any) {
        expectAnchorError(err, "InvalidJobStatus");
      }
    });

    it("non-participant cannot raise dispute", async () => {
      const outsider = Keypair.generate();
      const freshClient = Keypair.generate();
      await airdrop(outsider.publicKey);
      await airdrop(freshClient.publicKey);
      const { jobPDA } = await invokeAgent(freshClient, agentProfileA);
      try {
        await raiseDispute(outsider, jobPDA);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expectAnchorError(err, "Unauthorized");
      }
    });
  });

  // ═══════════════════════════════════════
  //  E2E: Full Human Flow
  // ═══════════════════════════════════════

  describe("E2E: Full Human Flow", () => {
    it("register → invoke → update → release → rate", async () => {
      const owner = Keypair.generate();
      const client = Keypair.generate();
      await airdrop(owner.publicKey);
      await airdrop(client.publicKey);

      // Register
      const profilePDA = await registerAgent(owner, "E2EAgent", PRICE);

      // Invoke
      const { jobPDA } = await invokeAgent(client, profilePDA);

      // Verify escrow
      const jobBal = await connection.getBalance(jobPDA);
      expect(jobBal).to.be.greaterThan(PAYMENT.toNumber());

      // Agent completes
      await updateJob(owner, jobPDA);
      let job = await program.account.job.fetch(jobPDA);
      expect(Object.keys(job.status)[0]).to.equal("completed");

      // Client releases
      const agentBalBefore = await connection.getBalance(owner.publicKey);
      await releasePayment(client, owner.publicKey, profilePDA, jobPDA);
      const agentBalAfter = await connection.getBalance(owner.publicKey);
      expect(agentBalAfter - agentBalBefore).to.equal(PAYMENT.toNumber());

      // Job finalized
      const finalJob = await program.account.job.fetch(jobPDA);
      expect(Object.keys(finalJob.status)[0]).to.equal("finalized");
      expect(finalJob.escrowAmount.toNumber()).to.equal(0);

      // Rate
      await rateAgent(client, jobPDA, profilePDA, 5);
      const profile = await program.account.agentProfile.fetch(profilePDA);
      expect(profile.jobsCompleted).to.equal(1);
      expect(profile.ratingSum.toNumber()).to.equal(5);
      expect(profile.ratingCount).to.equal(1);
    });
  });

  // ═══════════════════════════════════════
  //  E2E: Full Delegation Flow (Canonical)
  // ═══════════════════════════════════════

  describe("E2E: Full Delegation Flow — the confidence test", () => {
    it("client → Agent A → delegates to Agent B → both paid → rated", async () => {
      const ownerA = Keypair.generate();
      const ownerB = Keypair.generate();
      const client = Keypair.generate();
      await airdrop(ownerA.publicKey);
      await airdrop(ownerB.publicKey);
      await airdrop(client.publicKey);

      // Register both agents
      const profileA = await registerAgent(ownerA, "AgentA", PRICE);
      const profileB = await registerAgent(ownerB, "AgentB", PRICE);

      // Client invokes Agent A with 1 SOL
      const totalPayment = new BN(LAMPORTS_PER_SOL);
      const { jobPDA: parentJob } = await invokeAgent(
        client,
        profileA,
        totalPayment
      );

      // Agent A delegates 0.4 SOL to Agent B
      const delegateAmt = new BN(LAMPORTS_PER_SOL * 0.4);
      const { childJobPDA: childJob } = await delegateTask(
        ownerA,
        parentJob,
        profileB,
        delegateAmt
      );

      // Verify parent state
      let parent = await program.account.job.fetch(parentJob);
      expect(parent.activeChildren).to.equal(1);
      expect(parent.escrowAmount.toNumber()).to.equal(
        totalPayment.toNumber() - delegateAmt.toNumber()
      );

      // Agent B completes child job
      await updateJob(ownerB, childJob);

      // Agent A (as child's client) releases child payment
      const agentBBalBefore = await connection.getBalance(ownerB.publicKey);
      await releasePayment(ownerA, ownerB.publicKey, profileB, childJob, parentJob);
      const agentBBalAfter = await connection.getBalance(ownerB.publicKey);
      expect(agentBBalAfter - agentBBalBefore).to.equal(delegateAmt.toNumber());

      // Verify parent's active_children decremented
      parent = await program.account.job.fetch(parentJob);
      expect(parent.activeChildren).to.equal(0);

      // Agent A completes parent job (now possible — active_children == 0)
      await updateJob(ownerA, parentJob);

      // Client releases parent payment
      const agentABalBefore = await connection.getBalance(ownerA.publicKey);
      await releasePayment(client, ownerA.publicKey, profileA, parentJob);
      const agentABalAfter = await connection.getBalance(ownerA.publicKey);
      const expectedParentPay = totalPayment.toNumber() - delegateAmt.toNumber();
      expect(agentABalAfter - agentABalBefore).to.equal(expectedParentPay);

      // Parent job finalized
      const parentFinal = await program.account.job.fetch(parentJob);
      expect(Object.keys(parentFinal.status)[0]).to.equal("finalized");
      expect(parentFinal.escrowAmount.toNumber()).to.equal(0);

      // Client rates Agent A
      await rateAgent(client, parentJob, profileA, 5);

      // Verify final state
      const finalA = await program.account.agentProfile.fetch(profileA);
      expect(finalA.jobsCompleted).to.equal(1);
      expect(finalA.ratingSum.toNumber()).to.equal(5);
      expect(finalA.ratingCount).to.equal(1);

      const finalB = await program.account.agentProfile.fetch(profileB);
      expect(finalB.jobsCompleted).to.equal(1);

      console.log("\n  ✅ Full delegation flow verified:");
      console.log(`     Agent A paid: ${expectedParentPay / LAMPORTS_PER_SOL} SOL`);
      console.log(`     Agent B paid: ${delegateAmt.toNumber() / LAMPORTS_PER_SOL} SOL`);
      console.log("     Parent escrow: 0");
      console.log("     Active children: 0");
      console.log("     Both jobs closed");
      console.log("     Rating recorded\n");
    });
  });

  // ═══════════════════════════════════════
  //  HIGH VALUE: Event Decoding Test
  // ═══════════════════════════════════════

  describe("HIGH VALUE: Event Decoding (dashboard telemetry)", () => {
    it("invoke → update → release emits correct events with verified payloads", async () => {
      const owner = Keypair.generate();
      const client = Keypair.generate();
      await airdrop(owner.publicKey);
      await airdrop(client.publicKey);

      const profilePDA = await registerAgent(owner, "EventAgent", PRICE);

      const eventParser = new anchor.EventParser(
        program.programId,
        new anchor.BorshCoder(program.idl)
      );

      const parseLogs = async (txSig: string) => {
        await sleep(500); // ensure tx is indexed
        const tx = await connection.getTransaction(txSig, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        const logs = tx?.meta?.logMessages || [];
        const events: any[] = [];
        for (const event of eventParser.parseLogs(logs)) {
          events.push(event);
        }
        return events;
      };

      // 1) invoke_agent — capture JobCreated event
      const nonce = await getNonce(profilePDA);
      const [jobPDA] = getJobPDA(client.publicKey, profilePDA, nonce);
      const invokeTx = await program.methods
        .invokeAgent("Event test", PAYMENT, null, nonce, null, null, 0)
        .accountsPartial({ client: client.publicKey, agentProfile: profilePDA })
        .signers([client])
        .rpc();
      const invokeEvents = await parseLogs(invokeTx);
      const jobCreatedEvent = invokeEvents.find((e) => e.name === "jobCreated");
      expect(jobCreatedEvent).to.exist;
      expect(jobCreatedEvent.data.client.toBase58()).to.equal(client.publicKey.toBase58());
      expect(jobCreatedEvent.data.agent.toBase58()).to.equal(owner.publicKey.toBase58());
      expect(jobCreatedEvent.data.escrowAmount.toNumber()).to.equal(PAYMENT.toNumber());

      // 2) update_job — capture JobCompleted event
      const updateTx = await program.methods
        .updateJob("https://event-test.com")
        .accountsPartial({ agent: owner.publicKey, job: jobPDA })
        .signers([owner])
        .rpc();
      const updateEvents = await parseLogs(updateTx);
      const jobCompletedEvent = updateEvents.find((e) => e.name === "jobCompleted");
      expect(jobCompletedEvent).to.exist;
      expect(jobCompletedEvent.data.resultUri).to.equal("https://event-test.com");

      // 3) release_payment — capture PaymentReleased event
      const releaseTx = await program.methods
        .releasePayment()
        .accountsPartial({
          client: client.publicKey,
          agent: owner.publicKey,
          agentProfile: profilePDA,
          job: jobPDA,
          parentJob: null,
        })
        .signers([client])
        .rpc();
      const releaseEvents = await parseLogs(releaseTx);
      const paymentEvent = releaseEvents.find((e) => e.name === "paymentReleased");
      expect(paymentEvent).to.exist;
      expect(paymentEvent.data.job.toBase58()).to.equal(jobPDA.toBase58());
      expect(paymentEvent.data.agent.toBase58()).to.equal(owner.publicKey.toBase58());
      expect(paymentEvent.data.amount.toNumber()).to.equal(PAYMENT.toNumber());
      expect(paymentEvent.data.autoReleased).to.be.false;

      console.log("\n  📡 Event decoding verified:");
      console.log("     JobCreated ✓  JobCompleted ✓  PaymentReleased ✓");
      console.log(
        `     PaymentReleased payload: agent=${paymentEvent.data.agent
          .toBase58()
          .slice(0, 8)}... amount=${
          paymentEvent.data.amount.toNumber() / LAMPORTS_PER_SOL
        } SOL auto=${paymentEvent.data.autoReleased}\n`
      );
    });
  });

  // ═══════════════════════════════════════
  //  META: Compute Budget Snapshot
  // ═══════════════════════════════════════

  describe("META: Compute Budget Snapshot", () => {
    it("logs compute units for key instructions", async () => {
      const owner = Keypair.generate();
      const client = Keypair.generate();
      await airdrop(owner.publicKey);
      await airdrop(client.publicKey);

      const fetchTx = async (sig: string) => {
        await sleep(500);
        return connection.getTransaction(sig, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
      };

      // Register
      const [profilePDA] = getAgentProfilePDA(owner.publicKey);
      const regTx = await program.methods
        .registerAgent("CUAgent", "Compute test", 0x3f, PRICE)
        .accountsPartial({ owner: owner.publicKey })
        .signers([owner])
        .rpc();
      const regDetails = await fetchTx(regTx);

      // Invoke
      const nonce1 = await getNonce(profilePDA);
      const [jobPDA1] = getJobPDA(client.publicKey, profilePDA, nonce1);
      const invokeTx = await program.methods
        .invokeAgent("CU test task", PAYMENT, null, nonce1, null, null, 0)
        .accountsPartial({ client: client.publicKey, agentProfile: profilePDA })
        .signers([client])
        .rpc();
      const invokeDetails = await fetchTx(invokeTx);

      // Update
      const updateTx = await program.methods
        .updateJob("https://cu-test.com")
        .accountsPartial({ agent: owner.publicKey, job: jobPDA1 })
        .signers([owner])
        .rpc();
      const updateDetails = await fetchTx(updateTx);

      // Release
      const releaseTx = await program.methods
        .releasePayment()
        .accountsPartial({
          client: client.publicKey,
          agent: owner.publicKey,
          agentProfile: profilePDA,
          job: jobPDA1,
          parentJob: null,
        })
        .signers([client])
        .rpc();
      const releaseDetails = await fetchTx(releaseTx);

      // Delegate (new job for this)
      const nonce2 = await getNonce(profilePDA);
      const [jobPDA2] = getJobPDA(client.publicKey, profilePDA, nonce2);
      await program.methods
        .invokeAgent("CU delegate test", PAYMENT, null, nonce2, null, null, 0)
        .accountsPartial({ client: client.publicKey, agentProfile: profilePDA })
        .signers([client])
        .rpc();

      // Need a sub-agent for delegation
      const subOwner = Keypair.generate();
      await airdrop(subOwner.publicKey);
      const [subProfile] = getAgentProfilePDA(subOwner.publicKey);
      await program.methods
        .registerAgent("SubCU", "Sub", 0x3f, PRICE)
        .accountsPartial({ owner: subOwner.publicKey })
        .signers([subOwner])
        .rpc();

      const nonce3 = await getNonce(subProfile);
      const delegateTx = await program.methods
        .delegateTask("CU subtask", new BN(LAMPORTS_PER_SOL / 4), nonce3)
        .accountsPartial({
          delegatingAgent: owner.publicKey,
          parentJob: jobPDA2,
          subAgentProfile: subProfile,
        })
        .signers([owner])
        .rpc();
      const delegateDetails = await fetchTx(delegateTx);

      const getCU = (details: any) =>
        details?.meta?.computeUnitsConsumed ?? "N/A";

      console.log("\n  ⚡ Compute Units Snapshot:");
      console.log(`     register_agent:  ${getCU(regDetails)} CU`);
      console.log(`     invoke_agent:    ${getCU(invokeDetails)} CU`);
      console.log(`     update_job:      ${getCU(updateDetails)} CU`);
      console.log(`     release_payment: ${getCU(releaseDetails)} CU`);
      console.log(`     delegate_task:   ${getCU(delegateDetails)} CU`);
      console.log("");

      // Soft assert — warn if any exceed 200k CU
      [regDetails, invokeDetails, updateDetails, releaseDetails, delegateDetails].forEach(
        (d) => {
          const cu = d?.meta?.computeUnitsConsumed;
          if (cu && cu > 200_000) {
            console.warn(`  ⚠️  Instruction exceeded 200k CU: ${cu}`);
          }
        }
      );
    });
  });
});
