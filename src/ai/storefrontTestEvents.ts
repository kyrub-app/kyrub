import type { KyrubiaStorefrontTestCandidate } from '../../shared/kyrubiaStorefrontTestIntent';

export const KYRUBIA_STOREFRONT_TEST_PROPOSAL_EVENT =
  'kyrubia-storefront-test-proposal';

export type KyrubiaStorefrontTestProposalEventDetail = {
  conversationId: string;
  items: [KyrubiaStorefrontTestCandidate, KyrubiaStorefrontTestCandidate];
};
