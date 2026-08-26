import type { CreateStorePromotionProposal } from '../../shared/storePromotionAction';

export const KYRUB_STORE_PROMOTION_PROPOSAL_EVENT =
  'kyrub-store-promotion-proposal';

export type KyrubStorePromotionProposalEventDetail = {
  conversationId: string;
  requestId: string;
  proposal: CreateStorePromotionProposal;
};

export const emitKyrubStorePromotionProposal = (
  conversationId: string,
  requestId: string,
  proposal: CreateStorePromotionProposal
): void => {
  if (typeof window === 'undefined' || proposal.requiresConfirmation !== true) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<KyrubStorePromotionProposalEventDetail>(
      KYRUB_STORE_PROMOTION_PROPOSAL_EVENT,
      { detail: { conversationId, requestId, proposal } }
    )
  );
};
