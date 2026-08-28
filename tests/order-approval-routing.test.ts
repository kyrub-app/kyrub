import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflowSource = readFileSync('src/utils/orderWorkflow.ts', 'utf8');
const attendanceReviewSource = readFileSync(
  'server/inventory/attendanceReviewService.ts',
  'utf8'
);
const paymentWebhookSource = readFileSync(
  'server/payments/paymentWebhookProcessor.ts',
  'utf8'
);
const approvalSource = readFileSync(
  'src/components/customer/AttendanceOrderApproval.tsx',
  'utf8'
);
const inboxSource = readFileSync(
  'src/components/customer/CustomerOrderInbox.tsx',
  'utf8'
);
const retailerSource = readFileSync('src/components/RetailerPanel.tsx', 'utf8');

test('self-service dine-in orders require staff approval before KDS', () => {
  assert.match(workflowSource, /source === 'customer'/);
  assert.match(workflowSource, /fulfillmentType === 'dine_in'/);
  assert.match(workflowSource, /status === 'pending'/);
  assert.match(workflowSource, /!order\.operatorId\.trim\(\)/);
  assert.match(retailerSource, /isOrderVisibleInKds/);
  assert.match(retailerSource, /orders=\{kdsOrders\}/);
});

test('Kyrub marketplace delivery and pickup require paid status before KDS', () => {
  assert.match(workflowSource, /order\.source !== 'customer'/);
  assert.match(workflowSource, /order\.fulfillmentType === 'dine_in'/);
  assert.match(workflowSource, /isNinetyNineFoodOrder\(order\)/);
  assert.match(workflowSource, /order\.paymentStatus === 'paid'/);
});

test('authoritative paid webhook materializes the marketplace order transactionally', () => {
  assert.match(paymentWebhookSource, /current\.context === 'marketplace'/);
  assert.match(paymentWebhookSource, /PAYMENT_INTENT_NOT_FOUND/);
  assert.match(paymentWebhookSource, /assertMarketplacePaymentIntentMatchesPayment/);
  assert.match(paymentWebhookSource, /materializePaidMarketplaceOrder/);
  assert.match(paymentWebhookSource, /effectiveStatus === 'paid'/);
  assert.match(paymentWebhookSource, /transaction\.get\(legacyOrderRef\)/);
  assert.match(paymentWebhookSource, /transaction\.get\(canonicalOrderRef\)/);
  assert.match(paymentWebhookSource, /transaction\.set\(canonicalOrderRef/);
  assert.match(paymentWebhookSource, /transaction\.set\(legacyOrderRef, operationalOrder\)/);
  assert.match(paymentWebhookSource, /orderMaterialized/);
});

test('staff approval releases the order but leaves KDS acceptance pending', () => {
  assert.match(approvalSource, /Aprovação do atendimento/);
  assert.match(approvalSource, /updateQuantity/);
  assert.match(approvalSource, /Aprovar e enviar ao KDS/);
  assert.match(workflowSource, /reviewAttendanceOrder/);
  assert.match(workflowSource, /attendance-review/);
  assert.match(attendanceReviewSource, /status: 'pending'/);
  assert.match(attendanceReviewSource, /operatorId: normalizedTenantId/);
});

test('attendance and KDS rejection require reason and support alternatives', () => {
  assert.match(approvalSource, /Motivo obrigatório/);
  assert.match(approvalSource, /Alternativa sugerida/);
  assert.match(attendanceReviewSource, /status: 'rejected'/);
  assert.match(inboxSource, /confirmRejection/);
  assert.match(inboxSource, /rejectionReason/);
  assert.match(inboxSource, /suggestedAlternative/);
  assert.match(attendanceReviewSource, /Motivo da recusa/);
  assert.match(attendanceReviewSource, /Alternativa sugerida/);
});

test('KDS exposes origin filter above production stage filters', () => {
  const originIndex = inboxSource.indexOf('Origem do pedido');
  const stageIndex = inboxSource.indexOf("{filterOptions.map");
  assert.ok(originIndex >= 0);
  assert.ok(stageIndex > originIndex);
  assert.match(workflowSource, /Kyrub Ofertas/);
  assert.match(workflowSource, /marketplace:99food/);
  assert.match(workflowSource, /attendanceSpaces/);
});
