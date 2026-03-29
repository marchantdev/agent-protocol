import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { PROGRAM_ID, SEEDS } from './constants';

export function getAgentProfilePDA(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.AGENT, owner.toBuffer()],
    PROGRAM_ID,
  );
}

export function getJobPDA(
  client: PublicKey,
  agentProfile: PublicKey,
  nonce: BN,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.JOB, client.toBuffer(), agentProfile.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)],
    PROGRAM_ID,
  );
}

export function getRatingPDA(job: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.RATING, job.toBuffer()],
    PROGRAM_ID,
  );
}

export function getStakeVaultPDA(agentProfile: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.STAKE, agentProfile.toBuffer()],
    PROGRAM_ID,
  );
}
