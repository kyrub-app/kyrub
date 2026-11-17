export const DELIVERY_RETURN_ECONOMIC_POLICY_ID = 'kyrub_delivery_return_v1' as const;
export const DELIVERY_RETURN_ECONOMIC_POLICY_VERSION = 1 as const;
import { quoteDeliveryReturnTariffs, type DeliveryReturnTariffQuote } from './deliveryReturnTariffQuote.js';

/**
 * Advisory policy model. The amounts shown here are not orders to pay, debit,
 * refund or settle. Pricing is only valid when backed by a contract and an
 * independently verified authority; unavailable is never represented as zero.
 */
export type ReturnEconomicSegmentKind = 'original_route' | 'authorized_return' | 'additional_waiting' | 'buyer_refund';
export type ReturnEconomicSegmentStatus =
  | 'captured_pending_review'
  | 'captured_zero_requires_review'
  | 'authority_unavailable'
  | 'contract_terms_required'
  | 'waiting_evidence_and_terms_required'
  | 'consumer_rights_review_required'
  | 'quoted_pending_independent_review';
export interface ReturnEconomicSegment {
  id: string;
  kind: ReturnEconomicSegmentKind;
  amountMinor: number | null;
  currency: 'BRL';
  status: ReturnEconomicSegmentStatus;
  fundingResponsibility: 'pending_human_classification';
}
export interface DeliveryReturnEconomicPreview {
  schemaVersion: 1;
  policyId: typeof DELIVERY_RETURN_ECONOMIC_POLICY_ID;
  policyVersion: typeof DELIVERY_RETURN_ECONOMIC_POLICY_VERSION;
  deliveryId: string;
  orderId: string;
  courierId: string;
  receivedCondition: 'intact' | 'damaged' | 'disputed';
  sourceCaptureId: string | null;
  duplicateOrIneligibleObligation: boolean;
  pendingObligationIds: string[];
  segments: [ReturnEconomicSegment, ReturnEconomicSegment, ReturnEconomicSegment, ReturnEconomicSegment];
  totalRecognizedMinor: null;
  settlementStatus: 'blocked_pending_independent_reconciliation';
  refundStatus: 'requires_separate_consumer_rights_review';
  contractGraceMinutes: number | null;
  tariffQuote: DeliveryReturnTariffQuote;
}

const safeId = (value: string): string => {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) {
    throw new Error('DELIVERY_RETURN_ECONOMICS_INVALID');
  }
  return value;
};

export const buildDeliveryReturnEconomicPreview = (input: {
  deliveryId: string;
  orderId: string;
  courierId: string;
  receivedCondition: 'intact' | 'damaged' | 'disputed';
  sourceCaptureId: string | null;
  originalRouteMinor: number | null;
  existingCourierObligations: Array<{ id: string; status: string }>;
  acceptedTariffTerms?: unknown;
  claimAcceptedAt?: unknown;
  returnAuthorizationAt?: unknown;
  independentReturnDistanceAuthority?: unknown;
  recipientWaitingCorroboratedInterval?: unknown;
}): DeliveryReturnEconomicPreview => {
  const deliveryId = safeId(input.deliveryId);
  const orderId = safeId(input.orderId);
  const courierId = safeId(input.courierId);
  if (!['intact', 'damaged', 'disputed'].includes(input.receivedCondition)
    || (input.originalRouteMinor !== null
      && (!Number.isSafeInteger(input.originalRouteMinor) || input.originalRouteMinor < 0))
    || (input.sourceCaptureId !== null && !input.sourceCaptureId.trim())) {
    throw new Error('DELIVERY_RETURN_ECONOMICS_INVALID');
  }
  const quote=quoteDeliveryReturnTariffs({
    deliveryId,courierId,
    acceptedTerms:input.acceptedTariffTerms,
    claimAcceptedAt:input.claimAcceptedAt,
    returnAuthorizationAt:input.returnAuthorizationAt,
    returnDistanceAuthority:input.independentReturnDistanceAuthority,
    recipientWaitingAuthority:input.recipientWaitingCorroboratedInterval,
  });
  const obligations = input.existingCourierObligations;
  const ids = obligations.map(obligation => obligation.id);
  if (ids.some(id => !id || id.includes('/')) || new Set(ids).size !== ids.length) {
    throw new Error('DELIVERY_RETURN_ECONOMICS_INVALID');
  }
  const segment = (
    kind: ReturnEconomicSegmentKind,
    amountMinor: number | null,
    status: ReturnEconomicSegmentStatus
  ): ReturnEconomicSegment => ({
    id: 'delivery:' + deliveryId + ':economic:' + kind,
    kind, amountMinor, currency: 'BRL', status,
    fundingResponsibility: 'pending_human_classification',
  });
  const originalStatus: ReturnEconomicSegmentStatus =
    input.originalRouteMinor === null ? 'authority_unavailable'
      : input.originalRouteMinor === 0 ? 'captured_zero_requires_review'
        : 'captured_pending_review';
  return {
    schemaVersion: 1,
    policyId: DELIVERY_RETURN_ECONOMIC_POLICY_ID,
    policyVersion: DELIVERY_RETURN_ECONOMIC_POLICY_VERSION,
    deliveryId, orderId, courierId,
    receivedCondition: input.receivedCondition,
    sourceCaptureId: input.sourceCaptureId,
    duplicateOrIneligibleObligation: obligations.some(obligation =>
      obligation.status === 'eligible' || obligation.status === 'settled'
    ),
    pendingObligationIds: obligations.filter(obligation =>
      obligation.status === 'pending'
    ).map(obligation => obligation.id).sort(),
    segments: [
      segment('original_route', input.originalRouteMinor, originalStatus),
      segment('authorized_return', quote.returnMinor,
        quote.returnMinor!==null?'quoted_pending_independent_review':'contract_terms_required'),
      segment('additional_waiting', quote.recipientWaitingMinor,
        quote.recipientWaitingMinor!==null?'quoted_pending_independent_review':'waiting_evidence_and_terms_required'),
      segment('buyer_refund', null, 'consumer_rights_review_required'),
    ],
    // No invented total: without a return tariff or recipient-waiting terms,
    // even an original captured fee cannot be interpreted as a final payable.
    totalRecognizedMinor: null,
    settlementStatus: 'blocked_pending_independent_reconciliation',
    refundStatus: 'requires_separate_consumer_rights_review',
    // Ten minutes is a proposed parameter, not a signed contract or timer.
    contractGraceMinutes: quote.contractGraceMinutes,
    tariffQuote: quote,
  };
};
