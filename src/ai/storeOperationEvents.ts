import type { StoreOperationProposal } from '../../shared/storeOperationAction';

export const KYRUB_STORE_OPERATION_PROPOSAL_EVENT = 'kyrub-store-operation-proposal';

export type KyrubStoreOperationProposalEventDetail = {
  conversationId: string;
  requestId: string;
  proposal: StoreOperationProposal;
};

export const emitKyrubStoreOperationProposal = (
  conversationId: string,
  requestId: string,
  proposal: StoreOperationProposal
): void => {
  if (typeof window === 'undefined' || proposal.requiresConfirmation !== true) return;
  window.dispatchEvent(new CustomEvent<KyrubStoreOperationProposalEventDetail>(
    KYRUB_STORE_OPERATION_PROPOSAL_EVENT,
    { detail: { conversationId, requestId, proposal } }
  ));
};
