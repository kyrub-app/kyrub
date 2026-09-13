import type { User } from 'firebase/auth';
import { readKyrubErpContext } from '../actions/erpReadActionService';
import {
  isKyrubiaStorePromotionIntent,
  resolveKyrubiaDeterministicStorePromotion,
} from './deterministicStorePromotion';
import {
  resolveKyrubiaStoreConnectionDeclarationIntent,
  storeConnectionChannelLabel,
} from './deterministicStoreConnectionOnboarding';
import { loadKyrubiaOperationalWorkflow } from './operationalWorkflowStore';
import { emitKyrubStoreConnectionOnboardingProposal } from './storeConnectionOnboardingEvents';
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

export const shouldDeferStoreConnectionDeclarationToProductWorkflow = (
  workflow: { objective?: string; stage?: string } | null | undefined
): boolean =>
  workflow?.objective === 'create_product' &&
  workflow.stage === 'selecting_product_channels';

export const routeKyrubiaStorePromotionFromWorkspace = async (
  user: Pick<User, 'uid' | 'email'>,
  conversationId: string,
  message: string
): Promise<KyrubiaStorePromotionRouteResult> => {
  const activeOperationalWorkflow = typeof localStorage !== 'undefined'
    ? loadKyrubiaOperationalWorkflow(localStorage, user.uid, conversationId)
    : null;
  const channelDeclaration = shouldDeferStoreConnectionDeclarationToProductWorkflow(
    activeOperationalWorkflow
  )
    ? null
    : resolveKyrubiaStoreConnectionDeclarationIntent(message);

  if (channelDeclaration) {
    emitKyrubStoreConnectionOnboardingProposal(
      conversationId,
      channelDeclaration.answer,
      channelDeclaration.channels
    );
    const labels = channelDeclaration.channels.map(storeConnectionChannelLabel);
    return {
      handled: true,
      reply: labels.length > 0
        ? `Identifiquei que você já vende em ${labels.join(', ')}. Revise a confirmação que abri. Isso apenas registra os canais atuais da sua loja; não conecta contas nem importa dados.`
        : 'Entendi que você não vende em outros canais hoje. Revise a confirmação que abri. Isso apenas registra essa informação e não altera nenhuma integração.',
    };
  }

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
