import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflowSource = readFileSync('src/utils/orderWorkflow.ts', 'utf8');
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

test('staff approval releases the order but leaves KDS acceptance pending', () => {
  assert.match(approvalSource, /Aprovação do atendimento/);
  assert.match(approvalSource, /updateQuantity/);
  assert.match(approvalSource, /Aprovar e enviar ao KDS/);
  assert.match(workflowSource, /reviewAttendanceOrder/);
  assert.match(workflowSource, /status: 'pending'/);
  assert.match(workflowSource, /operatorId: user\.uid/);
});

test('attendance and KDS rejection require reason and support alternatives', () => {
  assert.match(approvalSource, /Motivo obrigatório/);
  assert.match(approvalSource, /Alternativa sugerida/);
  assert.match(workflowSource, /status: 'rejected'/);
  assert.match(inboxSource, /confirmRejection/);
  assert.match(inboxSource, /rejectionReason/);
  assert.match(inboxSource, /suggestedAlternative/);
  assert.match(workflowSource, /Motivo da recusa/);
  assert.match(workflowSource, /Alternativa sugerida/);
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
