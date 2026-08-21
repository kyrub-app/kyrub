import type { MarketplaceCheckoutIntentResult } from './marketplaceCheckout';

export const MARKETPLACE_PIX_READY_EVENT = 'kyrub-marketplace-pix-ready';

export type MarketplacePixReadyDetail = MarketplaceCheckoutIntentResult;

export const dispatchMarketplacePixReady = (
  detail: MarketplacePixReadyDetail
): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<MarketplacePixReadyDetail>(MARKETPLACE_PIX_READY_EVENT, {
      detail,
    })
  );
};
