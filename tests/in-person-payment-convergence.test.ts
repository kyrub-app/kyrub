import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  classifyCompatiblePaymentRecord,
  isLegacyTablePaymentMirror,
} from '../server/payments/paymentRecordCompatibility';
import type { CanonicalPayment } from '../src/utils/canonicalPayment';

const canonicalPayment = (): CanonicalPayment => ({
  id: 'pay-1',
  storeId: 'store-1',
  orderId: 'order-1',
  buyerId: 'customer-1',
  amount: 42.5,
  currency: 'BRL',
  method: 'pix',
  context: 'table',
  status: 'paid',
  provider: 'mercado_pago',
  providerPaymentId: 'mp-1',
  idempotencyKey: 'table-order-1-payment-1',
  createdAt: '2026-09-16T12:00:00.000Z',
  updatedAt: '2026-09-16T12:01:00.000Z',
  paidAt: '2026-09-16T12:01:00.000Z',
  refundedAt: '',
});

const legacyMirror = () => ({
  id: 'legacy-table-payment-1',
  storeId: 'store-1',
  legacyStoreId: 'owner-1',
  tableCode: 'MESA 7',
  method: 'card',
  amount: 42.5,
  quantity: 1,
  items: [{
    orderId: 'order-1',
    lineId: 'line-1',
    productId: 'product-1',
    name: 'Produto',
    quantity: 1,
    unitPrice: 42.5,
    total: 42.5,
  }],
  actorUserId: 'owner-1',
  actorRole: 'owner',
  actorName: 'Operador',
  legacyCreatedAt: '2026-09-16T12:00:00.000Z',
  migratedFromPath: 'artifacts/owner-1/public/data/tablePayments/legacy-table-payment-1',
  migration: {
    mode: 'dual_write',
    migratedByUserId: 'owner-1',
    migratedByRole: 'owner',
  },
});

describe('in-person payment convergence', () => {
  test('recognizes a real CanonicalPayment without changing its authority', () => {
    const source = canonicalPayment();
    const result = classifyCompatiblePaymentRecord(source, 'store-1');
    assert.equal(result.kind, 'canonical');
    if (result.kind === 'canonical') {
      assert.equal(result.payment.id, source.id);
      assert.equal(result.payment.context, 'table');
      assert.equal(result.payment.status, 'paid');
      assert.equal(result.payment.providerPaymentId, 'mp-1');
    }
  });

  test('recognizes the historical table-payment mirror as compatibility data, not CanonicalPayment', () => {
    const source = legacyMirror();
    assert.equal(isLegacyTablePaymentMirror(source, 'store-1'), true);
    assert.equal(
      classifyCompatiblePaymentRecord(source, 'store-1').kind,
      'legacy_table_payment_mirror'
    );
  });

  test('does not silently forgive unknown malformed payment documents', () => {
    assert.throws(
      () => classifyCompatiblePaymentRecord({
        id: 'mystery',
        storeId: 'store-1',
        amount: 20,
      }, 'store-1')
    );
  });

  test('legacy mirror remains store scoped', () => {
    assert.equal(isLegacyTablePaymentMirror(legacyMirror(), 'store-2'), false);
  });

  test('CRM skips known legacy mirrors but still requires authoritative canonical status for purchases', () => {
    const service = readFileSync('server/payments/storeCrmService.ts', 'utf8');
    assert.match(service, /classifyCompatiblePaymentRecord/);
    assert.match(service, /classified\.kind === 'canonical' \? classified\.payment : null/);
    assert.match(service, /if \(!payment\) continue/);
    assert.match(service, /isPaymentAuthoritativelyPaid\(payment\.status\)/);
    assert.match(service, /confirmedPurchases: paid\.length/);
  });

  test('historical staff table payment flow is preserved rather than reimplemented here', () => {
    const operations = readFileSync('src/utils/tableOperations.ts', 'utf8');
    assert.match(operations, /export type TablePaymentMethod = 'cash' \| 'pix' \| 'card' \| 'other'/);
    assert.match(operations, /export const registerTablePayment/);
    assert.match(operations, /public\/data\/tablePayments/);
    assert.match(operations, /paidQuantity: item\.paidQuantity \+ selectedQuantity/);
  });

  test('modern payment contract already reserves table and POS contexts', () => {
    const payment = readFileSync('src/utils/canonicalPayment.ts', 'utf8');
    assert.match(payment, /PaymentContext = 'marketplace' \| 'table' \| 'pos'/);
    assert.match(payment, /PaymentMethod = 'pix' \| 'card' \| 'cash' \| 'other'/);
    assert.match(payment, /isPaymentAuthoritativelyPaid/);
  });

  test('current real PaymentIntent endpoint is marketplace-specific and must be extended, not copied, for dine-in', () => {
    const router = readFileSync('server/payments/paymentIntentRouter.ts', 'utf8');
    assert.match(router, /fulfillmentType: 'delivery' \| 'pickup'/);
    assert.match(router, /context: 'marketplace'/);
    assert.match(router, /attachMercadoPagoPixToExistingIntent/);
    assert.doesNotMatch(router, /context: 'table'/);
  });

  test('customer account already exists as a read model and does not confirm payment by itself', () => {
    const drawer = readFileSync('src/components/modals/B2CCartDrawerApprovalBase.tsx', 'utf8');
    assert.match(drawer, /id="customer-account-panel"/);
    assert.match(drawer, /A forma de pagamento e o fechamento são confirmados pela loja/);
    assert.match(drawer, /accountTotals\.outstanding/);
  });

  test('versioned convergence map forbids duplicate payment engines and classifies terminal requests as service requests', () => {
    const document = readFileSync('docs/in-person-payment-convergence.md', 'utf8');
    assert.match(document, /Não criar uma segunda máquina de pagamento presencial/);
    assert.match(document, /Chamar staff \/ solicitar maquininha/);
    assert.match(document, /Service Request/);
    assert.match(document, /não altera `paymentStatus`/);
    assert.match(document, /não cria `CanonicalPayment`/);
    assert.match(document, /Pix real reutiliza o provider e o processador canônico existentes/);
    assert.match(document, /`registerTablePayment` só pode ser aposentado depois/);
  });

  test('this convergence cut adds no second payment or intent creation path', () => {
    const compatibility = readFileSync(
      'server/payments/paymentRecordCompatibility.ts',
      'utf8'
    );
    const crm = readFileSync('server/payments/storeCrmService.ts', 'utf8');
    const combined = `${compatibility}\n${crm}`;
    assert.doesNotMatch(combined, /paymentIntents\/|createPaymentIntent|attachMercadoPago|registerTablePayment\(/);
    assert.doesNotMatch(combined, /transaction\.set\([^\n]*(?:payment|Payment)/);
  });
});
