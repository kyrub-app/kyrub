import type { User } from 'firebase/auth';
import { readKyrubErpContext } from '../actions/erpReadActionService';
import {
  isKyrubiaStorePromotionIntent,
  resolveKyrubiaDeterministicStorePromotion,
} from './deterministicStorePromotion';
import { emitKyrubStorePromotionProposal } from './storePromotionEvents';

const runtimeId = (prefix: string): string => {
  try {
    return `${prefix}:${globalThis.crypto.randomUUID()}`;
  } catch {
    return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  }
};

export type KyrubiaStorePromotionRouteResult = {
  handled: boolean;
  reply?: string;
};

export const routeKyrubiaStorePromotionFromWorkspace = async (
  user: Pick<User, 'uid' | 'email'>,
  conversationId: string,
  message: string
): Promise<KyrubiaStorePromotionRouteResult> => {
  if (!isKyrubiaStorePromotionIntent(message)) {
    return { handled: false };
  }

  const context = await readKyrubErpContext(user, { force: true });
  const resolution = resolveKyrubiaDeterministicStorePromotion(message, context);

  if (!resolution) {
    return {
      handled: true,
      reply:
        'Entendi que você quer criar uma promoção, mas não consegui resolver com segurança o produto e o desconto usando o catálogo atual. Informe o nome exato do produto e o percentual ou valor do desconto.',
    };
  }

  emitKyrubStorePromotionProposal(
    conversationId,
    runtimeId('promotion-request'),
    resolution.proposal
  );

  return {
    handled: true,
    reply: resolution.reply,
  };
};
