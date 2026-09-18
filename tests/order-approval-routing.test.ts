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
const tableBoardSource = readFileSync(
  'src/components/customer/CustomerTableBoard.tsx',
  'utf8'
);
const serviceLocationWorkspaceSource = readFileSync(
  'src/components/store/ServiceLocationOperationalWorkspaceBridge.tsx',
  'utf8'
);
const serviceLocationRequestPanelSource = readFileSync(
  'src/components/store/ServiceLocationRequestPanel.tsx',
  'utf8'
);
const inPersonCustomerLinkerSource = readFileSync(
  'src/components/store/InPersonCustomerLinker.tsx',
  'utf8'
);
const inPersonOrderComposerSource = readFileSync(
  'src/components/store/InPersonOrderComposer.tsx',
  'utf8'
);
const workspaceNavigationSource = readFileSync(
  'src/utils/serviceLocationWorkspace.ts',
  'utf8'
);
const mainSource = readFileSync('src/main.tsx', 'utf8');
const retailerSource = readFileSync('src/components/RetailerPanel.tsx', 'utf8');

test('self-service dine-in orders require staff approval before KDS', () => {
  assert.match(workflowSource, /source === 'customer'/);
  assert.match(workflowSource, /fulfillmentType === 'dine_in'/);
  assert.match(workflowSource, /status === 'pending'/);
  assert.match(workflowSource, /!order\.operatorId\.trim\(\)/);
  assert.match(workflowSource, /resolveOrderServiceLocation/);
  assert.match(workflowSource, /Boolean\(attendanceLocationFor\(order\)\)/);
  assert.doesNotMatch(
    workflowSource,
    /Boolean\(order\.tableCode\.trim\(\)\)/
  );
  assert.match(retailerSource, /isOrderVisibleInKds/);
  assert.match(retailerSource, /orders=\{kdsOrders\}/);
});

test('canonical non-table locations use stable service-location identity for approval routing', () => {
  assert.match(workflowSource, /getPendingAttendanceOrdersForLocation/);
  assert.match(workflowSource, /serviceLocationIdentityKey\(location\)/);
  assert.match(workflowSource, /serviceLocationIdentityKey\(orderLocation\) === expected/);
  assert.match(workflowSource, /resolvedLocation\?\.source === 'canonical'/);
  assert.match(approvalSource, /serviceLocation\?: ResolvedOrderServiceLocation/);
  assert.match(approvalSource, /getPendingAttendanceOrdersForLocation/);
});

test('non-table service locations open a dedicated operational workspace instead of table finance', () => {
  assert.match(tableBoardSource, /location\.kind === 'table'/);
  assert.match(tableBoardSource, /requestServiceLocationWorkspaceOpen/);
  assert.match(workspaceNavigationSource, /kyrub-service-location-workspace-open/);
  assert.match(serviceLocationWorkspaceSource, /serviceLocationIdentityKey/);
  assert.match(serviceLocationWorkspaceSource, /Atendimento local/);
  assert.match(serviceLocationWorkspaceSource, /Pagamento e transferência permanecem fora deste workspace/);
  assert.doesNotMatch(serviceLocationWorkspaceSource, /registerTablePayment/);
  assert.doesNotMatch(serviceLocationWorkspaceSource, /transferTableItems/);
  assert.match(mainSource, /<ServiceLocationOperationalWorkspaceBridge \/>/);
});

test('selected service location workspace surfaces the same operational service requests without creating payment authority', () => {
  assert.match(serviceLocationWorkspaceSource, /<ServiceLocationRequestPanel/);
  assert.match(serviceLocationWorkspaceSource, /location=\{location\}/);
  assert.match(serviceLocationRequestPanelSource, /loadActiveLocalServiceRequests/);
  assert.match(serviceLocationRequestPanelSource, /serviceLocationIdentityKey\(request\.serviceLocation\) === expected/);
  assert.match(serviceLocationRequestPanelSource, /acknowledgeLocalServiceRequest/);
  assert.match(serviceLocationRequestPanelSource, /resolveLocalServiceRequest/);
  assert.match(serviceLocationRequestPanelSource, /Chamados deste local/);
  assert.match(serviceLocationRequestPanelSource, /não registra pagamento/);
  assert.doesNotMatch(serviceLocationRequestPanelSource, /paymentStatus/);
  assert.doesNotMatch(serviceLocationRequestPanelSource, /paidQuantity/);
  assert.doesNotMatch(serviceLocationRequestPanelSource, /registerTablePayment/);
});

test('staff can identify an in-person customer from the selected service location without broadening identity or payment authority', () => {
  assert.match(serviceLocationWorkspaceSource, /hasStaffOrder/);
  assert.match(serviceLocationWorkspaceSource, /activeOrders\.some\(order => order\.source === 'staff'\)/);
  assert.match(serviceLocationWorkspaceSource, /<InPersonCustomerLinker/);
  assert.match(serviceLocationWorkspaceSource, /orders=\{activeOrders\}/);
  assert.match(inPersonCustomerLinkerSource, /order\.source === 'staff'/);
  assert.match(inPersonCustomerLinkerSource, /CPF e telefone usam correspondência exata/);
  assert.match(inPersonCustomerLinkerSource, /Identificar o Cairuvi não confirma pagamento/);
  assert.match(inPersonCustomerLinkerSource, /loadInPersonCustomerContext/);
  assert.match(inPersonCustomerLinkerSource, /linkInPersonCustomer/);
  assert.doesNotMatch(inPersonCustomerLinkerSource, /paymentStatus\s*=/);
  assert.doesNotMatch(inPersonCustomerLinkerSource, /paidQuantity\s*=/);
});

test('staff can create another order in the selected canonical service location without fabricating a table code', () => {
  assert.match(serviceLocationWorkspaceSource, /<InPersonOrderComposer/);
  assert.match(serviceLocationWorkspaceSource, /lockedServiceLocationId=\{location\.id\}/);
  assert.match(inPersonOrderComposerSource, /lockedServiceLocationId\?: string/);
  assert.match(inPersonOrderComposerSource, /serviceLocationId: selectedLocationId/);
  assert.match(inPersonOrderComposerSource, /Este local não está mais ativo para novos pedidos/);
  assert.match(inPersonOrderComposerSource, /id="locked-service-location"/);
  assert.doesNotMatch(inPersonOrderComposerSource, /tableCode:/);
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
  assert.match(paymentWebhookSource, /transaction\.get\(orderRef\)/);
  assert.match(paymentWebhookSource, /transaction\.set\(orderRef, operationalOrder\)/);
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
