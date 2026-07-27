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
  assert.match(retailerSource, /isOrderVisibleInKds/);
  assert.match(retailerSource, /orders=\{kdsOrders\}/);
});

test('attendance review supports edit, approve and justified rejection', () => {
  assert.match(approvalSource, /Aprovação do atendimento/);
  assert.match(approvalSource, /updateQuantity/);
  assert.match(approvalSource, /Aprovar e enviar ao KDS/);
  assert.match(approvalSource, /Motivo obrigatório/);
  assert.match(approvalSource, /Alternativa sugerida/);
  assert.match(workflowSource, /reviewAttendanceOrder/);
  assert.match(workflowSource, /status: 'accepted'/);
  assert.match(workflowSource, /status: 'rejected'/);
});

test('KDS exposes origin filter above production stage filters', () => {
  const originIndex = inboxSource.indexOf('Origem do pedido');
  const stageIndex = inboxSource.indexOf("{filterOptions.map");
  assert.ok(originIndex >= 0);
  assert.ok(stageIndex > originIndex);
  assert.match(inboxSource, /Kyrub Ofertas/);
  assert.match(workflowSource, /marketplace:99food/);
  assert.match(workflowSource, /attendanceSpaces/);
});

test('KDS rejection captures reason and suggested alternative', () => {
  assert.match(inboxSource, /confirmRejection/);
  assert.match(inboxSource, /rejectionReason/);
  assert.match(inboxSource, /suggestedAlternative/);
  assert.match(workflowSource, /Motivo da recusa/);
  assert.match(workflowSource, /Alternativa sugerida/);
});
