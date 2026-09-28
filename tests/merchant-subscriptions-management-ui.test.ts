import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import './store-subscription-benefit-ledger.test';
import './store-subscription-benefit-management-ui.test';
import './official-store-identity.test';

const navigation = readFileSync('src/utils/erpManagementNavigation.ts', 'utf8');
const menu = readFileSync('src/components/MobileErpMenu.tsx', 'utf8');
const router = readFileSync('src/components/RetailerPanelRuntimeRouter.tsx', 'utf8');
const runtime = readFileSync('src/components/store/StoreSubscriptionsRuntime.tsx', 'utf8');
const workspace = readFileSync('src/components/store/StoreSubscriptionsWorkspace.tsx', 'utf8');

describe('merchant subscriptions management UI', () => {
  test('subscriptions is a first-class direct management destination rather than the removed legacy Gerencial route', () => {
    assert.match(navigation, /\| 'assinaturas'/);
    assert.match(menu, /id: 'assinaturas', label: 'Assinaturas'/);
    assert.match(menu, /'assinaturas',/);
    assert.match(router, /assinaturas: \{ title: 'Assinaturas'/);
    assert.match(router, /moduleId === 'assinaturas'/);
    assert.match(router, /LazySubscriptionsRuntime/);
    assert.match(router, /Gerencial foi removido\./);
    assert.doesNotMatch(router, /GerencialPanel/);
  });

  test('subscription management auth and Firebase load only after the direct module is selected', () => {
    assert.match(router, /lazy\(async \(\) => \{ const module = await import\('\.\/store\/StoreSubscriptionsRuntime'\)/);
    assert.doesNotMatch(router, /from 'firebase\/auth'/);
    assert.doesNotMatch(router, /from '\.\.\/utils\/firebase'/);
    assert.match(runtime, /from 'firebase\/auth'/);
    assert.match(runtime, /from '\.\.\/\.\.\/utils\/firebase'/);
    assert.match(runtime, /user\.uid !== storeId/);
    assert.match(runtime, /<StoreSubscriptionsWorkspace/);
  });

  test('management workspace consumes only the canonical subscriber registry and CRM reconciliation adapter', () => {
    assert.match(workspace, /loadStoreSubscriberRegistry/);
    assert.match(workspace, /reconcileStoreSubscribersWithCrm/);
    assert.match(workspace, /data-kyrub-store-subscriptions="canonical-registry"/);
    assert.doesNotMatch(workspace, /createAuthorizedStoreSubscription|createMerchantSubscription|createStoreSubscription/);
    assert.doesNotMatch(workspace, /cancelAuthorizedStoreSubscription|cancelMerchantSubscription|cancelStoreSubscription/);
    assert.doesNotMatch(workspace, /mercadoPagoStoreRequest|externalAccountId|credentialScopeId/);
  });

  test('workspace exposes every canonical lifecycle state without inventing demo subscribers or revenue', () => {
    for (const state of ['active', 'payment_due', 'pending', 'paused', 'cancelled']) {
      assert.match(workspace, new RegExp(`['\"]${state}['\"]`));
    }
    assert.match(workspace, /A tela não cria dados de demonstração/);
    assert.doesNotMatch(workspace, /mockSubscriber|fakeSubscriber|demoSubscriber|seedSubscriber/i);
    assert.doesNotMatch(workspace, /MRR|receita recorrente mensal|monthlyRecurringRevenue/i);
  });

  test('workspace can reconcile CRM but does not grant marketing consent or edit billing state', () => {
    assert.match(workspace, /Sincronizar CRM/);
    assert.match(workspace, /nenhuma contratação concede consentimento de marketing/);
    assert.doesNotMatch(workspace, /marketingConsent\s*=|status:\s*'granted'/);
    assert.doesNotMatch(workspace, /status:\s*'canceled'|status:\s*'cancelled'/);
  });
});
