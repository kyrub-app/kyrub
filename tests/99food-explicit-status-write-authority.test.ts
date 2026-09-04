import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routerSource = readFileSync(
  'server/inventory/orderInventoryRouter.ts',
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
const bridgeSource = readFileSync(
  'src/components/store/NinetyNineFoodOrderStatusBridge.tsx',
  'utf8'
);

test('99Food provider authorization is validated before the canonical local status transition', () => {
  const routeStart = routerSource.indexOf("router.post('/:orderId/status'");
  const routeSection = routerSource.slice(routeStart);
  const suppliedIndex = routeSection.indexOf('const providerAuthorizationSupplied =');
  const parseIndex = routeSection.indexOf('parseProviderWriteAuthorization(');
  const invalidIndex = routeSection.indexOf("throw new Error('Autorização 99Food inválida para este status do pedido.')");
  const providerMismatchIndex = routeSection.indexOf("throw new Error('Autorização 99Food não corresponde ao provedor deste pedido.')");
  const transitionIndex = routeSection.indexOf('transitionOrderStatusWithInventory(');

  assert.ok(routeStart >= 0);
  assert.ok(suppliedIndex >= 0);
  assert.ok(parseIndex > suppliedIndex);
  assert.ok(invalidIndex > parseIndex);
  assert.ok(providerMismatchIndex > invalidIndex);
  assert.ok(transitionIndex > providerMismatchIndex);
  assert.match(routerSource, /candidate\.provider !== '99food'/);
  assert.match(routerSource, /candidate\.confirmed !== true/);
  assert.match(routerSource, /candidate\.status !== expectedStatus/);
});

test('99Food provider write only occurs after explicit structured authorization', () => {
  const routeStart = routerSource.indexOf("router.post('/:orderId/status'");
  const routeSection = routerSource.slice(routeStart);
  const providerBlockStart = routeSection.indexOf("if (result.provider === '99food' && result.externalOrderId)");
  const providerBlock = routeSection.slice(providerBlockStart);
  const authorizationRequiredIndex = providerBlock.indexOf('if (!providerWriteAuthorization)');
  const pendingMarkerIndex = providerBlock.indexOf('markPartnerSyncAuthorizationRequired');
  const sendIndex = providerBlock.indexOf('sendNinetyNineFoodOrderStatus(');

  assert.ok(providerBlockStart >= 0);
  assert.ok(authorizationRequiredIndex >= 0);
  assert.ok(pendingMarkerIndex > authorizationRequiredIndex);
  assert.ok(sendIndex > pendingMarkerIndex);
  assert.match(providerBlock, /partnerSync = 'authorization-required'/);
  assert.match(providerBlock, /partnerSync = 'sent'/);
  assert.match(providerBlock, /partnerSync = 'attention'/);
  assert.doesNotMatch(
    providerBlock.slice(authorizationRequiredIndex, sendIndex),
    /sendNinetyNineFoodOrderStatus\(/
  );
});

test('client asks for explicit authority before recording or posting a 99Food status change', () => {
  const functionStart = workflowSource.indexOf('export const updateOrderStatusWithDecision = async');
  const functionEnd = workflowSource.indexOf('export const reviewAttendanceOrder', functionStart);
  const section = workflowSource.slice(functionStart, functionEnd);
  const requestIndex = section.indexOf('requestNinetyNineFoodStatusWriteAuthority({');
  const choiceIndex = section.indexOf("if (choice === 'kyrub_and_99food')");
  const activityIndex = section.indexOf("recordOrderActivity(\n    'interaction.action_attempted'");
  const fetchIndex = section.indexOf('await fetch(');

  assert.ok(requestIndex >= 0);
  assert.ok(choiceIndex > requestIndex);
  assert.ok(activityIndex > choiceIndex);
  assert.ok(fetchIndex > activityIndex);
  assert.match(section, /provider: '99food'/);
  assert.match(section, /status: nextStatus/);
  assert.match(section, /confirmed: true/);
  assert.match(section, /\.\.\.\(providerWriteAuthorization \? \{ providerWriteAuthorization \} : \{\}\)/);
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

test('provider result messaging preserves local success when external write needs attention', () => {
  assert.match(workflowSource, /publishNinetyNineFoodStatusWriteResult\(\{/);
  assert.match(bridgeSource, /foi atualizado no Kyrub, mas a 99Food não confirmou o envio/);
  assert.match(bridgeSource, /foi atualizado somente no Kyrub/);
  assert.match(bridgeSource, /foi atualizado no Kyrub e a 99Food aceitou o envio/);
  assert.doesNotMatch(bridgeSource, /retryNinetyNineFoodBlockedOrderReservation|sendNinetyNineFoodOrderStatus/);
});
