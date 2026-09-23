import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routerSource = readFileSync(
  'server/integrations/fiscalHomologationOrchestratorRouter.ts',
  'utf8'
);
const transportSource = readFileSync(
  'server/integrations/storeConnectionsServerlessTransport.ts',
  'utf8'
);
const executionSource = readFileSync(
  'server/integrations/fiscalProviderExecutionService.ts',
  'utf8'
);

test('orchestrator is mounted under store-connections', () => {
  assert.match(transportSource, /createFiscalHomologationOrchestratorRouter/);
  assert.match(transportSource, /\/api\/store-connections\/fiscal-homologation/);
});

test('prepare accepts only server-resolved order identity and makes no provider call', () => {
  assert.match(routerSource, /orders\/:orderId\/prepare/);
  assert.match(routerSource, /prepareFiscalHomologationAttempt/);
  assert.match(routerSource, /prepareFiscalExecutableDocumentSnapshot/);
  assert.match(routerSource, /bindFiscalTaxExecutionPolicyToAttempt/);
  assert.match(routerSource, /providerCallMade: false/);
  assert.match(routerSource, /sefazCallMade: false/);

  const prepareStart = routerSource.indexOf("router.post('/:storeId/orders/:orderId/prepare'");
  const executeStart = routerSource.indexOf("router.post('/:storeId/attempts/:attemptId/execute'");
  const prepareBlock = routerSource.slice(prepareStart, executeStart);
  assert.doesNotMatch(prepareBlock, /executePreparedFiscalHomologationAttempt|adapter\.submit|focusnfe/i);
  assert.doesNotMatch(prepareBlock, /request\.body/);
});

test('execution and reconciliation are separate explicit owner-only actions', () => {
  assert.match(routerSource, /attempts\/:attemptId\/execute/);
  assert.match(routerSource, /executePreparedFiscalHomologationAttempt/);
  assert.match(routerSource, /attempts\/:attemptId\/reconcile/);
  assert.match(routerSource, /reconcileFiscalHomologationAttempt/);
  assert.match(routerSource, /identity\.uid !== storeId/);
  assert.match(routerSource, /adminAuth\.verifyIdToken/);
});

test('reconciliation advertises no resubmission and executor remains GET-status only', () => {
  const reconcileStart = routerSource.indexOf("router.post('/:storeId/attempts/:attemptId/reconcile'");
  const reconcileBlock = routerSource.slice(reconcileStart);
  assert.match(reconcileBlock, /resubmitted: false/);
  assert.doesNotMatch(reconcileBlock, /executePreparedFiscalHomologationAttempt|\.submit\(/);

  const serviceReconcileStart = executionSource.indexOf('export const reconcileFiscalHomologationAttempt');
  const serviceReconcile = executionSource.slice(serviceReconcileStart);
  assert.match(serviceReconcile, /adapter\.getStatus/);
  assert.doesNotMatch(serviceReconcile, /adapter\.submit/);
});

test('browser cannot forge fiscal authority, policies, payment evidence or provider config', () => {
  assert.doesNotMatch(routerSource, /request\.body\?\.(?:policy|taxPolicy|payment|provider|adapter|environment|authority|canonicalStoreId)/);
  assert.doesNotMatch(routerSource, /request\.body\.(?:policy|taxPolicy|payment|provider|adapter|environment|authority|canonicalStoreId)/);
  assert.match(routerSource, /tenantId: identity\.uid/);
  assert.match(routerSource, /requestedByUserId: identity\.uid/);
});

test('all orchestration remains sandbox-only in public responses', () => {
  assert.match(routerSource, /environment: 'sandbox'/);
  assert.doesNotMatch(routerSource, /environment: 'production'/);
  assert.doesNotMatch(routerSource, /production.*emit|emit.*production/i);
});
