import type { KyrubCommerceChannel } from '../../shared/storeConnections.js';

export const KYRUB_STORE_CONNECTION_ONBOARDING_PROPOSAL_EVENT =
  'kyrub:store-connection-onboarding-proposal';

export type KyrubStoreConnectionOnboardingProposalEventDetail = {
  conversationId: string;
  answer: string;
  channels: KyrubCommerceChannel[];
};

export const emitKyrubStoreConnectionOnboardingProposal = (
  conversationId: string,
  answer: string,
  channels: KyrubCommerceChannel[]
): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<KyrubStoreConnectionOnboardingProposalEventDetail>(
    KYRUB_STORE_CONNECTION_ONBOARDING_PROPOSAL_EVENT,
    { detail: { conversationId, answer, channels } }
  ));
};
