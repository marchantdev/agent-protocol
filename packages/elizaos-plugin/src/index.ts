import { registerAgentAction } from './actions/registerAgent.js';
import { hireAgentAction } from './actions/hireAgent.js';
import { completeJobAction } from './actions/completeJob.js';
import { releasePaymentAction } from './actions/releasePayment.js';
import { listAgentsAction } from './actions/listAgents.js';
import { checkJobStatusAction } from './actions/checkJobStatus.js';
import { stakeAgentAction, unstakeAgentAction } from './actions/stakeAgent.js';
import {
  rejectJobAction,
  cancelJobAction,
  raiseDisputeAction,
  rateAgentAction,
  delegateTaskAction,
  closeJobAction,
} from './actions/jobActions.js';
import { agentProtocolProvider } from './providers/agentStatus.js';

const agentProtocolPlugin = {
  name: 'agent-protocol',
  description: 'Trustless agent-to-agent payments on Solana — escrow, staking, arbitration, delegation',
  actions: [
    registerAgentAction,
    hireAgentAction,
    completeJobAction,
    releasePaymentAction,
    listAgentsAction,
    checkJobStatusAction,
    stakeAgentAction,
    unstakeAgentAction,
    rejectJobAction,
    cancelJobAction,
    raiseDisputeAction,
    rateAgentAction,
    delegateTaskAction,
    closeJobAction,
  ],
  providers: [
    agentProtocolProvider,
  ],
  evaluators: [],
  services: [],
};

export default agentProtocolPlugin;

// Named exports for individual use
export {
  registerAgentAction,
  hireAgentAction,
  completeJobAction,
  releasePaymentAction,
  listAgentsAction,
  checkJobStatusAction,
  stakeAgentAction,
  unstakeAgentAction,
  rejectJobAction,
  cancelJobAction,
  raiseDisputeAction,
  rateAgentAction,
  delegateTaskAction,
  closeJobAction,
  agentProtocolProvider,
};
