import type { CanonicalPaymentIntent } from '../../src/utils/canonicalPaymentIntent.js';
import {
  deriveKyrubEconomicPositions,
  moneyToMinorUnits,
  normalizeKyrubEconomicLedger,
  type KyrubEconomicLedger,
  type KyrubEconomicLedgerEntry,
} from '../../shared/kyrubEconomicLedger.js';

export const economicLedgerPath = (storeId: string, ledgerId: string): string =>
  `stores/${storeId.trim()}/economicLedgers/${ledgerId.trim()}`;

export const buildMarketplaceEconomicLedger = (input: {
  paymentId: string;
  intent: CanonicalPaymentIntent;
  economicStoreId: string;
  occurredAt: string;
}): KyrubEconomicLedger => {
  const paymentId = input.paymentId.trim();
  const economicStoreId = input.economicStoreId.trim();
  if (!paymentId || !economicStoreId) {
    throw new Error('ECONOMIC_LEDGER_TARGET_REQUIRED');
  }

  const draft = input.intent.orderDraft;
  const subtotalMinor = moneyToMinorUnits(draft.subtotal);
  const discountMinor = moneyToMinorUnits(draft.discountTotal ?? 0);
  const deliveryFeeMinor = moneyToMinorUnits(draft.deliveryFee);
  const paidMinor = moneyToMinorUnits(input.intent.amount);

  // Delivery economics are intentionally fail-closed until the delivery engine
  // defines who funds and who earns each freight component. Never guess a recipient.
  if (deliveryFeeMinor > 0) {
    throw new Error('ECONOMIC_DELIVERY_COMPONENT_UNMODELED');
  }

  const buyer = { id: input.intent.buyerId, role: 'buyer' as const };
  const merchant = { id: economicStoreId, role: 'merchant' as const };
  const entries: KyrubEconomicLedgerEntry[] = [];

  if (subtotalMinor > 0) {
    entries.push({
      id: `${paymentId}:sale`,
      kind: 'sale',
      amountMinor: subtotalMinor,
      fundedBy: buyer,
      owedTo: merchant,
      reference: {
        type: 'payment_intent',
        id: input.intent.id,
      },
      description: 'Valor bruto dos itens comprados.',
    });
  }

  if (discountMinor > 0) {
    const promotionId = draft.promotionSnapshot?.promotionId?.trim() ?? '';
    entries.push({
      id: `${paymentId}:discount`,
      kind: 'discount',
      amountMinor: discountMinor,
      fundedBy: merchant,
      owedTo: buyer,
      reference: promotionId
        ? { type: 'promotion', id: promotionId }
        : { type: 'payment_intent', id: input.intent.id },
      description: 'Desconto financiado pela loja no checkout.',
    });
  }

  const ledger = normalizeKyrubEconomicLedger({
    id: `economic-${paymentId}`,
    transactionId: input.intent.id,
    storeId: economicStoreId,
    orderId: draft.draftId,
    paymentId,
    currency: 'BRL',
    source: 'marketplace_payment',
    status: 'posted',
    entries,
    createdAt: input.occurredAt,
    schemaVersion: 1,
  });

  const positions = deriveKyrubEconomicPositions(ledger.entries);
  const buyerPosition = positions.find(position =>
    position.role === 'buyer' && position.participantId === input.intent.buyerId
  );
  if (!buyerPosition || buyerPosition.netMinor !== -paidMinor) {
    throw new Error('ECONOMIC_LEDGER_PAYMENT_MISMATCH');
  }

  return ledger;
};
