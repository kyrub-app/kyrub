import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './external-write-governance.test.js';

const routerSource = readFileSync(
  'server/inventory/orderInventoryRouter.ts',
  'utf8'
);
const executionRouterSource = readFileSync(
  'server/inventory/ninetyNineFoodStatusSyncExecutionRouter.ts',
  'utf8'
);
const workflowSource = readFileSync(
  'src/utils/orderWorkflow.ts',
  'utf8'
);
const authoritySource = readFileSync(
  'src/utils/ninetyNineFoodStatusWriteAuthority.ts',
  'utf8'
);
const pendingSyncSource = readFileSync(
  'src/utils/ninetyNineFoodPendingStatusSync.ts',
  'utf8'
);
const bridgeSource = readFileSync(
  'src/components/store/NinetyNineFoodOrderStatusBridge.tsx',
  'utf8'
);

test('legacy server 99Food provider authorization remains behind the pre-router shutdown boundary', () => {
  const routeStart = routerSource.indexOf("router.post('/:orderId/status'");
  const routeSection = routerSource.slice(routeStart);
  const suppliedIndex = routeSection.indexOf('const providerAuthorizationSupplied =');
  const parseIndex = routeSection.indexOf('parseProviderWriteAuthorization(');
  const transitionIndex = routeSection.indexOf('transitionOrderStatusWithInventory(');

  assert.ok(routeStart >= 0);
  assert.ok(suppliedIndex >= 0);
  assert.ok(parseIndex > suppliedIndex);
  assert.ok(transitionIndex > parseIndex);
});

test('99Food pre-router rejects embedded legacy provider authority before lock or legacy status handling', () => {
  const functionStart = executionRouterSource.indexOf('const serializeNinetyNineFoodStatusMutation = async');
  const functionEnd = executionRouterSource.indexOf('export const createNinetyNineFoodStatusSyncExecutionRouter', functionStart);
  const section = executionRouterSource.slice(functionStart, functionEnd);
  const providerIndex = section.indexOf("clean(integration.provider) !== '99food'");
  const legacyGuardIndex = section.indexOf('request.body?.providerWriteAuthorization !== undefined');
  const lockIndex = section.indexOf('claimOrderStatusMutation({ tenantId, orderId })');

  assert.ok(functionStart >= 0);
  assert.ok(providerIndex >= 0);
  assert.ok(legacyGuardIndex > providerIndex);
  assert.ok(lockIndex > legacyGuardIndex);
  assert.match(section, /response\.status\(410\)\.json/);
  assert.match(section, /NINETY_NINE_FOOD_LEGACY_STATUS_AUTHORITY_DISABLED/);
  assert.match(section, /autorização one-time do servidor/);
});

test('initial client never self-asserts provider authority in the local status POST', () => {
  const functionStart = workflowSource.indexOf('export const updateOrderStatusWithDecision = async');
  const functionEnd = workflowSource.indexOf('export const reviewAttendanceOrder', functionStart);
  const section = workflowSource.slice(functionStart, functionEnd);
  const choiceIndex = section.indexOf("choice === 'kyrub_and_99food'");
  const localFetchIndex = section.indexOf('/status`');
  const bodyIndex = section.indexOf('body: JSON.stringify({', localFetchIndex);
  const bodyEnd = section.indexOf('}),', bodyIndex);
  const localBody = section.slice(bodyIndex, bodyEnd);

  assert.ok(choiceIndex >= 0);
  assert.ok(localFetchIndex > choiceIndex);
  assert.match(localBody, /status: nextStatus/);
  assert.match(localBody, /decision/);
  assert.doesNotMatch(localBody, /providerWriteAuthorization|confirmed|authorizationId|authorizationToken/);
  assert.doesNotMatch(section, /confirmed:\s*true/);
});

test('Kyrub + 99Food reuses the revision-bound server one-time pending pipeline after local success', () => {
  const helperStart = workflowSource.indexOf('const syncInitialNinetyNineFoodExternalStatus = async');
  const functionStart = workflowSource.indexOf('export const updateOrderStatusWithDecision = async');
  const localFetchIndex = workflowSource.indexOf('/status`', functionStart);
  const localParseIndex = workflowSource.indexOf('const localResult = parseOrderStatusUpdateResult', localFetchIndex);
  const externalSyncIndex = workflowSource.indexOf('syncInitialNinetyNineFoodExternalStatus(user, localResult)', localParseIndex);

  assert.ok(helperStart >= 0);
  assert.match(workflowSource.slice(helperStart, functionStart), /loadNinetyNineFoodPendingStatusSyncs\(user\)/);
  assert.match(workflowSource.slice(helperStart, functionStart), /candidate\.orderId === result\.orderId/);
  assert.match(workflowSource.slice(helperStart, functionStart), /candidate\.status === result\.status/);
  assert.match(workflowSource.slice(helperStart, functionStart), /sendNinetyNineFoodPendingStatusSync\(user, item\)/);
  assert.ok(localFetchIndex >= 0);
  assert.ok(localParseIndex > localFetchIndex);
  assert.ok(externalSyncIndex > localParseIndex);
  assert.match(pendingSyncSource, /provider-sync\/99food\/authorize/);
  assert.match(pendingSyncSource, /authorizationId/);
  assert.match(pendingSyncSource, /authorizationToken/);
});

test('missing pending evidence blocks external write without rolling back the local transition', () => {
  const helperStart = workflowSource.indexOf('const syncInitialNinetyNineFoodExternalStatus = async');
  const helperEnd = workflowSource.indexOf('export const updateOrderStatusWithDecision', helperStart);
  const helper = workflowSource.slice(helperStart, helperEnd);
  assert.match(helper, /if \(!item\)/);
  assert.match(helper, /partnerSync: 'attention'/);
  assert.match(helper, /Nenhuma escrita externa foi tentada/);
  assert.match(helper, /catch \(error\)/);
  assert.doesNotMatch(helper, /throw error|transitionOrderStatusWithInventory|sendNinetyNineFoodOrderStatus/);
});

test('status authority broker is memory-only, exact, and supports only explicit choices', () => {
  assert.match(authoritySource, /let pendingAuthority: PendingAuthorityRequest \| null = null;/);
  assert.match(authoritySource, /'kyrub_only'/);
  assert.match(authoritySource, /'kyrub_and_99food'/);
  assert.match(authoritySource, /pendingAuthority\.request\.storeId !== normalized\.storeId/);
  assert.match(authoritySource, /pendingAuthority\.request\.orderId !== normalized\.orderId/);
  assert.match(authoritySource, /pendingAuthority\.request\.status !== normalized\.status/);
  assert.match(authoritySource, /pendingAuthority = null;/);
  assert.doesNotMatch(
    authoritySource,
    /localStorage|sessionStorage|firebase|firestore|\bfetch\(|setTimeout|setInterval/i
  );
});

test('99Food external choice crosses provider-neutral governance without granting authority to Kyrub-only', () => {
  const governanceIndex = authoritySource.indexOf('evaluateExternalWriteAuthorizationRequest({');
  const explicitChoiceIndex = authoritySource.indexOf("choice === 'kyrub_and_99food'");
  assert.ok(governanceIndex >= 0);
  assert.ok(explicitChoiceIndex >= 0);
  assert.match(authoritySource, /channel: '99food'/);
  assert.match(authoritySource, /operationKind: 'order\.status_transition'/);
  assert.match(authoritySource, /operationRef: `\$\{request\.orderId\}:\$\{request\.status\}`/);
  assert.match(authoritySource, /userSignal: 'explicit_authorization'/);
  assert.match(authoritySource, /authorizedFields: \['status'\]/);
  assert.match(authoritySource, /choice === 'kyrub_and_99food'[\s\S]*sharedGovernanceAllowsProviderWrite\(normalized\)/);
  assert.doesNotMatch(authoritySource, /choice === 'kyrub_only'[\s\S]{0,180}sharedGovernanceAllowsProviderWrite/);
});

test('99Food bridge is an authority/result UI and never performs the provider write itself', () => {
  assert.match(bridgeSource, /id="kyrub-99food-status-write-authority"/);
  assert.match(bridgeSource, /Atualizar só no Kyrub/);
  assert.match(bridgeSource, /Kyrub \+ 99Food/);
  assert.match(bridgeSource, /resolveNinetyNineFoodStatusWriteAuthority\(request, choice\)/);
  assert.match(bridgeSource, /Nenhuma alteração foi enviada à 99Food/);
  assert.match(bridgeSource, /nenhum retry externo é executado automaticamente/i);
  assert.doesNotMatch(
    bridgeSource,
    /sendNinetyNineFoodOrderStatus|collection\(|onSnapshot|hasPendingWrites|setDoc|updateDoc|\bfetch\(/
  );
});

test('provider result messaging preserves local success and exposes reconciliation state', () => {
  assert.match(workflowSource, /publishNinetyNineFoodStatusWriteResult\(\{/);
  assert.match(authoritySource, /'reconciliation-required'/);
  assert.match(authoritySource, /nenhum retry automático será feito/);
  assert.match(bridgeSource, /foi atualizado no Kyrub, mas a 99Food não confirmou o envio/);
  assert.match(bridgeSource, /foi atualizado somente no Kyrub/);
  assert.match(bridgeSource, /foi atualizado no Kyrub e a 99Food aceitou o envio/);
  assert.doesNotMatch(bridgeSource, /retryNinetyNineFoodBlockedOrderReservation|sendNinetyNineFoodOrderStatus/);
});
