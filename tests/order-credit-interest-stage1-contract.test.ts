import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { quoteOrderCompensation, quoteFutureStoreCreditUse } from '../shared/orderCompensationCredit';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const controller = read('src/components/store/KdsScopedRejectionController.tsx');
const service = read('server/payments/orderCreditInterestService.ts');
const router = read('server/payments/orderCreditInterestRouter.ts');
const transport = read('server/payments/storePromotionServerlessTransport.ts');
const buyer = read('src/components/store/BuyerCreditInterestCard.tsx');
const storefront = read('src/components/PublicStorefrontApp.tsx');
const postReject = read('src/components/store/PostRejectionCreditInterest.tsx');
const refundBridge = read('src/components/store/PaidOrderRefundBridge.tsx');
const creditContract = read('shared/orderCompensationCredit.ts');

test('same KDS rejection modal presents refund first and a separate voluntary credit consultation', () => {
  assert.match(controller, /Como abordar o valor pago\?/);
  assert.match(controller, /financialFollowup.*original_refund/);
  assert.match(controller, /Propor crédito em reais com bônus opcional/);
  assert.match(controller, /Bônus pelo transtorno/);
  assert.match(controller, /O total operacional do pedido pode estar zerado e não determina/);
  assert.match(controller, /'cobrança original a conferir'/);
  assert.doesNotMatch(controller, /Crédito estimado:.*order\.total/);
  assert.match(controller, /bonusPercent: creditBonusPercent/);
  assert.match(controller, /crédito proposto vale para compras futuras nesta loja/i);
  assert.match(controller, /scope === 'whole' && order\.paymentStatus === 'paid'/);
  assert.match(controller, /order\.buyerId &&/);
  assert.match(controller, /await updateOrderStatusWithDecision[\s\S]*?surface=credit-interest&path=offer/);
  assert.match(controller, /Nenhum cupom foi emitido/);
  assert.match(controller, /reembolso continua pendente/);
});

test('no credit, settlement or Pix is manufactured when the merchant offers consultation', () => {
  assert.match(service, /status: 'awaiting_response'/);
  assert.match(service, /creditIssued: false/);
  assert.match(service, /quoteOrderCompensation\(\{ paidMinor: amountMinor, bonusPercent \}\)/);
  assert.match(service, /previous.bonusPercent !== bonusPercent/);
  assert.match(service, /inspectOrderCreditInterestRefundSafety/);
  assert.match(service, /isCreditInterestRefundStatusEligible\(order\.refundStatus, refundGuard\.mode\)/);
  assert.match(service, /value === 'failed' && mode === 'audited_failed_attempt'/);
  assert.doesNotMatch(service, /transaction\.(set|update|delete)\(refundRef/);
  assert.match(service, /fullRefundSnapshot.exists/);
  assert.match(service, /evidenceSnapshot.get\('state'\) !== 'observed_no_refund_not_settled'/);
  assert.match(service, /all\[0\]\.status !== 'paid'/);
  assert.match(service, /clean\(order\.paymentStatus\) !== 'paid'/);
  assert.match(service, /!validId\(buyerId\)/);
  assert.match(service, /transaction\.create\(proposalRef, proposal\)/);
  assert.doesNotMatch(service, /transaction\.(set|update|delete)\(paymentRef/);
  assert.doesNotMatch(service, /transaction\.(set|update|delete)\(orderRef/);
  assert.doesNotMatch(service, /\/promotions\//);
  assert.doesNotMatch(service, /\/refunds/);
});

test('both actions are authenticated; buyer cannot choose or read another buyer proposal', () => {
  assert.match(router, /verifyFirebaseIdToken/);
  assert.match(router, /loadOwnerStoreInstitutionalRepresentation/);
  assert.match(router, /router.get\('\/status'/);
  assert.match(service, /loadOwnerCreditInterestProposal/);
  assert.match(router, /buyerId: identity\.uid/);
  assert.match(service, /value\.buyerId === buyerId/);
  assert.match(service, /proposal\.buyerId !== buyerId/);
  assert.match(service, /proposal\.status !== 'awaiting_response'/);
  assert.match(service, /paymentSnapshot\.get\('status'\)\) !== 'paid'/);
  assert.match(service, /value\.canonicalStoreId === storeId/);
  assert.match(transport, /surface === 'credit-interest'/);
});

test('buyer can express interest or prefer refund without final acceptance or redeemable promise', () => {
  assert.match(storefront, /<BuyerCreditInterestCard storeId=\{store\.id\} buyerId=\{user\.uid\}/);
  assert.match(buyer, /Tenho interesse em negociar crédito/);
  assert.match(buyer, /Crédito total proposto/);
  assert.match(buyer, /sem vincular o benefício a um produto específico/);
  assert.match(buyer, /Prefiro devolução do pagamento/);
  assert.match(buyer, /Mudei de ideia: prefiro a devolução do pagamento/);
  assert.match(service, /proposal.status === 'interested' && input.choice === 'prefers_refund'/);
  assert.match(buyer, /ainda não é um cupom/);
  assert.match(buyer, /Nenhum crédito foi emitido/);
});

test('compensation quote is storewide, cent-based and includes an optional goodwill percentage', () => {
  assert.deepEqual(quoteOrderCompensation({ paidMinor: 3000, bonusPercent: 20 }), {
    scope: 'storewide',
    principalMinor: 3000,
    bonusPercent: 20,
    bonusMinor: 600,
    totalCreditMinor: 3600,
  });
  assert.deepEqual(quoteOrderCompensation({ paidMinor: 995, bonusPercent: 15 }), {
    scope: 'storewide',
    principalMinor: 995,
    bonusPercent: 15,
    bonusMinor: 149,
    totalCreditMinor: 1144,
  });
  assert.equal(quoteOrderCompensation({ paidMinor: 1200, bonusPercent: 0 }).totalCreditMinor, 1200);
  assert.match(creditContract, /ORDER_COMPENSATION_SCOPE = 'storewide'/);
  assert.doesNotMatch(creditContract, /productIds|eligibleSkus|officialPlanId/);
});

test('compensation bonus cannot turn a customer consultation into an unbounded liability', () => {
  assert.throws(() => quoteOrderCompensation({ paidMinor: 0, bonusPercent: 20 }), /PRINCIPAL_INVALID/);
  assert.throws(() => quoteOrderCompensation({ paidMinor: 100, bonusPercent: -1 }), /BONUS_INVALID/);
  assert.throws(() => quoteOrderCompensation({ paidMinor: 100, bonusPercent: 101 }), /BONUS_INVALID/);
  assert.throws(() => quoteOrderCompensation({ paidMinor: 100, bonusPercent: 2.5 }), /BONUS_INVALID/);
  assert.throws(() => quoteOrderCompensation({ paidMinor: Number.MAX_SAFE_INTEGER, bonusPercent: 100 }), /AMOUNT_OVERFLOW/);
  assert.match(service, /Number.isInteger\(bonusPercent\)/);
});

test('future partial redemption preserves remainder in BRL and never spends more than purchase total', () => {
  assert.deepEqual(quoteFutureStoreCreditUse({availableMinor: 3600, purchaseTotalMinor: 1900}), {
    appliedMinor: 1900, balanceMinor: 1700, payableMinor: 0,
  });
  assert.deepEqual(quoteFutureStoreCreditUse({availableMinor: 3600, purchaseTotalMinor: 4500}), {
    appliedMinor: 3600, balanceMinor: 0, payableMinor: 900,
  });
  assert.throws(() => quoteFutureStoreCreditUse({availableMinor: -1, purchaseTotalMinor: 100}), /USE_INVALID/);
});

test('already-rejected order can separately consult credit interest without reopening or refunding', () => {
  assert.match(postReject, /Consultation only, for an order already rejected\/cancelled/);
  assert.match(refundBridge, /<PostRejectionCreditInterest storeId=\{storeId\} orderId=\{selectedOrder\.id\} \/>/);
  assert.match(refundBridge, /selectedOrder\.refundStatus !== 'refunded'/);
  assert.match(refundBridge, /Valor do reembolso a conferir/);
  assert.match(postReject, /const endpoint = '\/api\/health\?transport=store-promotions&surface=credit-interest'/);
  assert.match(postReject, /endpoint \+ '&path=offer'/);
  assert.match(postReject, /bonusPercent/);
  assert.match(postReject, /Nenhum crédito foi emitido e o reembolso continua pendente/);
  assert.match(postReject, /Atualizar resposta da compradora/);
  assert.match(postReject, /CREDIT_INTEREST_REFUND_EVIDENCE_REQUIRED/);
  assert.match(postReject, /CREDIT_INTEREST_PROVIDER_NOT_CONCLUSIVE/);
  assert.match(postReject, /Código: /);
  assert.match(postReject, /path: 'status'/);
  assert.doesNotMatch(postReject, /updateOrderStatusWithDecision|cancelOrderItemsWithRefund|requestCanonicalOrderRefund/);
  assert.match(service, /\['rejected', 'cancelled'\]/);
});
