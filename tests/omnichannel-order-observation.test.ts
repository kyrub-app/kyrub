import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const observerSource = readFileSync(
  'server/integrations/omnichannelOrderObservationService.ts',
  'utf8'
);
const routerSource = readFileSync(
  'server/integrations/omnichannelOrderObservationRouter.ts',
  'utf8'
);
const transportSource = readFileSync(
  'server/integrations/storeConnectionsServerlessTransport.ts',
  'utf8'
);
const vercelSource = readFileSync('vercel.json', 'utf8');

test('omnichannel order observer is owner-authenticated and read-only', () => {
  assert.match(routerSource, /verifyIdToken\(token, true\)/);
  assert.match(routerSource, /OMNICHANNEL_ORDER_OBSERVATION_FORBIDDEN/);
  assert.match(observerSource, /requestedByUserId/);
  assert.match(observerSource, /tenantId !== requestedByUserId/);
  assert.doesNotMatch(observerSource, /\.set\(/);
  assert.doesNotMatch(observerSource, /\.update\(/);
  assert.doesNotMatch(observerSource, /\.create\(/);
  assert.doesNotMatch(observerSource, /runTransaction/);
});

test('observer starts from ingress evidence so pre-order failures are visible', () => {
  assert.match(observerSource, /integrationIngress/);
  assert.match(observerSource, /integrationWebhookInbox/);
  assert.match(observerSource, /status === 'queued'/);
  assert.match(observerSource, /status === 'failed'/);
  assert.match(observerSource, /processingStatus/);
  assert.match(observerSource, /mercadoLivreOrderIngressBlocks/);
  assert.match(observerSource, /binding\.state = 'blocked'/);
});

test('observer correlates canonical KDS, inventory and divergence evidence', () => {
  assert.match(observerSource, /stores\/\$\{canonicalStoreId\}\/orders/);
  assert.match(observerSource, /routingTarget/);
  assert.match(observerSource, /toUpperCase\(\) === 'KDS'/);
  assert.match(observerSource, /inventoryReservation/);
  assert.match(observerSource, /blocked_product_binding_unresolved/);
  assert.match(observerSource, /omnichannelDivergences/);
  assert.match(observerSource, /integrationSyncDivergences/);
  assert.match(observerSource, /stage: 'divergence'/);
});

test('observer supports both 99Food and Mercado Livre without fabricating fiscal state', () => {
  assert.match(observerSource, /'99food'/);
  assert.match(observerSource, /'mercado_livre'/);
  assert.match(observerSource, /provider_api_refetch/);
  assert.doesNotMatch(observerSource, /fiscal|sefaz|cfop|cst/i);
});

test('serverless transport reuses the existing store-connections function budget', () => {
  assert.match(transportSource, /createOmnichannelOrderObservationRouter/);
  assert.match(transportSource, /\/api\/store-connections\/omnichannel/);
  assert.match(routerSource, /\/orders\/recent/);
  assert.match(vercelSource, /\/api\/store-connections\/:path\*/);
  assert.doesNotMatch(vercelSource, /omnichannel-order-observation/);
});
