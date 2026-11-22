import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const controller = read('src/components/store/KdsScopedRejectionController.tsx');
const service = read('server/payments/orderCreditInterestService.ts');
const router = read('server/payments/orderCreditInterestRouter.ts');
const transport = read('server/payments/storePromotionServerlessTransport.ts');
const buyer = read('src/components/store/BuyerCreditInterestCard.tsx');
const storefront = read('src/components/PublicStorefrontApp.tsx');

test('same KDS rejection modal presents refund first and a separate voluntary credit consultation', () => {
  assert.match(controller, /Como abordar o valor pago\?/);
  assert.match(controller, /financialFollowup.*original_refund/);
  assert.match(controller, /Consultar interesse em cupom compensatório/);
  assert.match(controller, /scope === 'whole' && order\.paymentStatus === 'paid'/);
  assert.match(controller, /order\.buyerId &&/);
  assert.match(controller, /await updateOrderStatusWithDecision[\s\S]*?surface=credit-interest&path=offer/);
  assert.match(controller, /Nenhum cupom foi emitido/);
  assert.match(controller, /reembolso continua pendente/);
});

test('no credit, settlement or Pix is manufactured when the merchant offers consultation', () => {
  assert.match(service, /status: 'awaiting_response'/);
  assert.match(service, /creditIssued: false/);
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
  assert.match(buyer, /Prefiro devolução do pagamento/);
  assert.match(buyer, /ainda não é um cupom/);
  assert.match(buyer, /Nenhum crédito foi emitido/);
});
