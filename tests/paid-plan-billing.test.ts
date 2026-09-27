import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const service = readFileSync('server/admin/paidPlanSubscriptionService.ts', 'utf8');
const gateway = readFileSync('api/plan-control.ts', 'utf8');
const client = readFileSync('src/utils/planSubscription.ts', 'utf8');
const planCenter = readFileSync('src/components/plans/PlanCenterApp.tsx', 'utf8');

const collectApiFunctions = (directory: string): string[] =>
  readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    return statSync(path).isDirectory()
      ? collectApiFunctions(path)
      : path.endsWith('.ts')
        ? [path]
        : [];
  });

test('paid billing uses a dedicated Kyrub platform credential and never seller Mercado Pago credentials', () => {
  assert.match(service, /KYRUB_BILLING_MERCADO_PAGO_ACCESS_TOKEN/);
  assert.match(service, /KYRUB_BILLING_MERCADO_PAGO_WEBHOOK_SECRET/);
  assert.doesNotMatch(service, /resolveMercadoPagoAccessToken|providerCredentialResolver|process\.env\.MERCADO_PAGO_ACCESS_TOKEN\b/);
});

test('checkout pins current Control Plane plan price and does not activate entitlement from browser input', () => {
  assert.match(service, /loadPublicActivePlanCatalog/);
  assert.match(service, /monthlyPriceBRL/);
  assert.match(service, /payer_email: user\.email/);
  assert.match(service, /status: 'pending'/);
  assert.match(service, /\/preapproval/);
  assert.doesNotMatch(client, /amount|monthlyPrice|payer_email|planVersion/);
  const checkout = service.indexOf("mpRequest('/preapproval'");
  const activation = service.indexOf('activateSubscriptionEntitlement');
  assert.ok(checkout > activation, 'activation helper may exist earlier, but checkout must not call it directly');
  const checkoutBody = service.slice(checkout, service.indexOf('export const reconcileOwnPaidPlanSubscription'));
  assert.doesNotMatch(checkoutBody, /activateSubscriptionEntitlement\(/);
});

test('provider-authorized subscription is the only paid activation path and writes source subscription', () => {
  assert.match(service, /status === 'authorized'/);
  assert.match(service, /await activateSubscriptionEntitlement/);
  assert.match(service, /source: 'subscription'/);
  assert.match(service, /providerSubscriptionId/);
  assert.match(service, /writePlanMirrors/);
});

test('webhook is signature checked and re-reads provider state instead of trusting webhook status', () => {
  assert.match(service, /verifyPaidPlanWebhookSignature/);
  assert.match(service, /createHmac\('sha256'/);
  assert.match(service, /timingSafeEqual/);
  assert.match(service, /where\('providerSubscriptionId', '==', providerSubscriptionId\)/);
  assert.match(service, /mpRequest\(`\/preapproval\/\$\{encodeURIComponent\(providerSubscriptionId\)\}`\)/);
  assert.match(gateway, /subscription\.webhook/);
  assert.match(gateway, /x-signature/);
  assert.match(gateway, /x-request-id/);
});

test('plan-control owns state, checkout, reconcile and cancel without adding a serverless function', () => {
  assert.match(gateway, /store\.subscription\.state/);
  assert.match(gateway, /store\.subscription\.checkout/);
  assert.match(gateway, /store\.subscription\.reconcile/);
  assert.match(gateway, /store\.subscription\.cancel/);
  assert.match(client, /getIdToken\(\)/);
  assert.match(client, /op=store\.subscription\.checkout/);
  assert.match(client, /JSON\.stringify\(\{ plan \}\)/);
  const apiFunctions = collectApiFunctions('api');
  assert.ok(apiFunctions.includes('api/plan-control.ts'));
  assert.equal(apiFunctions.some(path => path.includes('subscription') || path.includes('billing')), false);
  assert.ok(apiFunctions.length <= 11, `Expected serverless budget <= 11, found ${apiFunctions.length}`);
});

test('Plan Center dynamically reflects billing availability and never relies on the old compile-time flag', () => {
  assert.match(planCenter, /loadPlanBillingAvailability/);
  assert.match(planCenter, /createPaidPlanCheckout/);
  assert.match(planCenter, /reconcilePaidPlanSubscription/);
  assert.match(planCenter, /cancelPaidPlanSubscription/);
  assert.doesNotMatch(planCenter, /KYRUB_COMMERCIAL_PLAN_BILLING_AVAILABLE/);
  assert.match(planCenter, /plano só é ativado depois que o servidor confirma a autorização diretamente com o Mercado Pago/);
});
