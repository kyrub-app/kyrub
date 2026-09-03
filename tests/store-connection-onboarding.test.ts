import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildStoreCommerceChannelDeclarationFromAnswer,
} from '../shared/storeConnectionOnboarding.js';
import { parseStoreConnectionSyncAuthority } from '../server/integrations/storeConnectionRegistry.js';
import {
  resolveKyrubiaStoreConnectionDeclarationIntent,
} from '../src/ai/deterministicStoreConnectionOnboarding.js';
import { buildStoreChannelOperationalItems } from '../src/utils/storeChannelOperations.js';

test('merchant answer deterministically declares existing commerce channels without connecting them', () => {
  const declaration = buildStoreCommerceChannelDeclarationFromAnswer({
    storeId: 'store-a',
    declaredByUserId: 'store-a',
    answer: 'Já vendo no Mercado Livre, Shopee, iFood e Instagram.',
    declaredAt: '2026-08-30T23:30:00.000Z',
  });
  assert.deepEqual(declaration.channels, [
    'mercado_livre',
    'shopee',
    'ifood',
    'instagram',
  ]);
  assert.equal(declaration.authority, 'store_owner');
  assert.equal(declaration.source, 'merchant_onboarding');
});

test('merchant channel declaration is owner scoped', () => {
  assert.throws(
    () => buildStoreCommerceChannelDeclarationFromAnswer({
      storeId: 'store-a',
      declaredByUserId: 'store-b',
      answer: 'Mercado Livre',
      declaredAt: '2026-08-30T23:30:00.000Z',
    }),
    /STORE_CHANNEL_DECLARATION_SCOPE_INVALID/
  );
});

test('store connection onboarding API rejects cross-tenant identity before loading registry', () => {
  const source = readFileSync('server/integrations/storeConnectionOnboardingRouter.ts', 'utf8');
  assert.match(source, /identity\.uid !== storeId/);
  assert.match(source, /STORE_CONNECTION_FORBIDDEN/);
  assert.match(source, /\/api\/store-connections|createStoreConnectionOnboardingRouter/);
});

test('public store connection registry projection never exposes vault references or raw credentials', () => {
  const source = readFileSync('server/integrations/storeConnectionRegistry.ts', 'utf8');
  const projection = source.match(/const publicProjection[\s\S]*?\n};/)?.[0] ?? '';
  assert.match(projection, /credentialAuthority: 'vault'/);
  assert.doesNotMatch(projection, /credentialReference/);
  assert.doesNotMatch(projection, /accessToken|refreshToken|clientSecret/);
});

test('onboarding reads only the tenant-scoped registry and does not create external connections', () => {
  const source = readFileSync('server/integrations/storeConnectionOnboardingService.ts', 'utf8');
  assert.match(source, /listPublicStoreConnectionRegistry\(storeId\)/);
  assert.match(source, /loadOwnerStoreInstitutionalRepresentation/);
  assert.doesNotMatch(source, /saveStoreConnectionRegistryRecord/);
  assert.doesNotMatch(source, /accessToken|refreshToken|clientSecret/);
});

test('sync authority accepts only the explicit shared authority modes', () => {
  assert.equal(parseStoreConnectionSyncAuthority('external_to_kyrub'), 'external_to_kyrub');
  assert.equal(parseStoreConnectionSyncAuthority('manual_review'), 'manual_review');
  assert.throws(
    () => parseStoreConnectionSyncAuthority('automatic'),
    /STORE_CONNECTION_SYNC_AUTHORITY_INVALID/
  );
});

test('sync authority route is owner scoped and changes no credentials', () => {
  const router = readFileSync('server/integrations/storeConnectionOnboardingRouter.ts', 'utf8');
  const registry = readFileSync('server/integrations/storeConnectionRegistry.ts', 'utf8');
  assert.match(router, /\/:storeId\/:connectionId\/sync-authority/);
  assert.match(router, /authenticatedOwner/);
  const updater = registry.match(/export const updateStoreConnectionSyncAuthority[\s\S]*$/)?.[0] ?? '';
  assert.match(updater, /syncAuthority/);
  assert.doesNotMatch(updater, /credentialReference\s*:/);
  assert.doesNotMatch(updater, /accessToken|refreshToken|clientSecret/);
});

test('Mercado Livre remains manual review until a real sync runtime exists', () => {
  const registry = readFileSync('server/integrations/storeConnectionRegistry.ts', 'utf8');
  const router = readFileSync('server/integrations/storeConnectionOnboardingRouter.ts', 'utf8');
  assert.match(registry, /record\.provider === 'mercado_livre'/);
  assert.match(registry, /syncAuthority !== 'manual_review'/);
  assert.match(registry, /STORE_CONNECTION_SYNC_AUTHORITY_UNAVAILABLE/);
  assert.match(router, /status: 409/);
  assert.match(router, /sincronização automática deste canal ainda não está habilitada/);
});

test('Kyrubia recognizes explicit existing-channel declarations deterministically', () => {
  assert.deepEqual(
    resolveKyrubiaStoreConnectionDeclarationIntent('Já vendo no Mercado Livre e 99Food.'),
    {
      answer: 'Já vendo no Mercado Livre e 99Food.',
      channels: ['mercado_livre', '99food'],
      kind: 'channels_declared',
    }
  );
  assert.deepEqual(
    resolveKyrubiaStoreConnectionDeclarationIntent('Mercado Livre e 99Food'),
    {
      answer: 'Mercado Livre e 99Food',
      channels: ['mercado_livre', '99food'],
      kind: 'channels_declared',
    }
  );
});

test('Kyrubia does not turn questions, connection commands or future intent into declarations', () => {
  assert.equal(resolveKyrubiaStoreConnectionDeclarationIntent('Como conectar Mercado Livre?'), null);
  assert.equal(resolveKyrubiaStoreConnectionDeclarationIntent('Quero conectar o Mercado Livre'), null);
  assert.equal(resolveKyrubiaStoreConnectionDeclarationIntent('Quero vender na Shopee'), null);
  assert.equal(resolveKyrubiaStoreConnectionDeclarationIntent('Mercado Livre é bom para minha loja'), null);
});

test('Kyrubia can explicitly register that the merchant has no other sales channel', () => {
  assert.deepEqual(
    resolveKyrubiaStoreConnectionDeclarationIntent('Não vendo em nenhum outro lugar hoje.'),
    {
      answer: 'Não vendo em nenhum outro lugar hoje.',
      channels: [],
      kind: 'no_external_channels',
    }
  );
});

test('Kyrubia prepares channel declaration for human confirmation instead of persisting from the chat router', () => {
  const router = readFileSync('src/ai/storePromotionWorkspaceRouter.ts', 'utf8');
  assert.match(router, /resolveKyrubiaStoreConnectionDeclarationIntent/);
  assert.match(router, /emitKyrubStoreConnectionOnboardingProposal/);
  assert.match(router, /não conecta contas nem importa dados/);
  assert.doesNotMatch(router, /\/api\/store-connections/);
  assert.doesNotMatch(router, /saveStoreCommerceChannelDeclaration/);
});

test('channel confirmation persists only the reviewed declaration and never starts OAuth, imports or sync', () => {
  const bridge = readFileSync('src/components/KyrubAiStoreConnectionOnboardingBridge.tsx', 'utf8');
  const client = readFileSync('src/utils/storeConnectionOnboarding.ts', 'utf8');
  assert.match(bridge, /Confirmar canais/);
  assert.match(bridge, /Não conecta nenhuma conta/);
  assert.match(bridge, /saveStoreCommerceChannelDeclaration/);
  assert.match(client, /\/api\/store-connections\/\$\{encoded\(storeId\)\}\/channels/);
  assert.match(client, /method: 'PUT'/);
  assert.doesNotMatch(client, /authorize|catalog-import|sync-authority|accessToken|refreshToken|clientSecret/);
});

test('store operation bridge mounts the channel confirmation without adding another app root', () => {
  const source = readFileSync('src/components/KyrubAiStoreOperationActionBridge.tsx', 'utf8');
  assert.match(source, /KyrubAiStoreConnectionOnboardingBridge/);
  assert.match(source, /<KyrubAiStoreConnectionOnboardingBridge \/>/);
});

test('Central de Canais is a read-only projection over declaration and authoritative connection registry', () => {
  const source = readFileSync('src/components/store/StoreChannelCenter.tsx', 'utf8');
  assert.match(source, /Central de Canais/);
  assert.match(source, /loadStoreConnectionOnboarding/);
  assert.match(source, /Kyrub Marketplace/);
  assert.match(source, /if \(status === 'connected'\) return 'connected'/);
  assert.match(source, /type ChannelState = [^;]*'declared'/);
  assert.match(source, /declared\.has\(channel\)/);
  assert.match(source, /não conecta contas, não importa produtos, não altera estoque/);
  assert.doesNotMatch(source, /beginMercadoLivreConnection|connectNinetyNineFoodAdaptive|updateStoreConnectionSyncAuthority/);
});

test('Central de Canais is mounted above provider-specific workspaces without replacing them', () => {
  const source = readFileSync('src/components/store/StoreConnectionsPortalBridge.tsx', 'utf8');
  assert.match(source, /<StoreChannelCenter user=\{user\} storeId=\{storeId\} \/>/);
  assert.match(source, /<StoreConnectionsWorkspace user=\{user\} storeId=\{storeId\} notify=\{notify\} \/>/);
  assert.match(source, /<MercadoLivreE2ETestBridge/);
  assert.match(source, /<NinetyNineFoodE2ETestBridge/);
  assert.match(source, /kyrub-mercado-livre-channel-detail/);
});

test('multichannel operation normalizer prioritizes conflicts and avoids duplicate Mercado Livre review for the same proposal', () => {
  const items = buildStoreChannelOperationalItems({
    mercadoLivreReview: [{
      proposal: { id: 'proposal-1' },
      snapshot: { item: { externalId: 'MLB1', title: 'Produto A' } },
    }] as never[],
    mercadoLivreConflicts: [{
      proposalId: 'proposal-1',
      canonicalProductId: 'product-a',
      baselineStatus: 'conflict',
      resolvableFields: ['name'],
    }] as never[],
    ninetyNineFoodBlocked: [{
      orderId: 'order-99',
      externalOrderId: 'ext-99',
      displayId: '99',
      customerName: 'Cliente',
      blockedState: 'blocked_product_binding_unresolved',
      blockedDetail: 'binding ausente',
      status: 'accepted',
    }],
  });

  assert.equal(items.length, 2);
  assert.equal(items[0].kind, '99food_binding_unresolved');
  assert.equal(items[0].severity, 'critical');
  assert.equal(items[1].kind, 'mercado_livre_conflict');
  assert.equal(items.some(item => item.kind === 'mercado_livre_sync_review'), false);
});

test('multichannel queue reads authoritative sources and exposes only the internal 99Food reservation retry write', () => {
  const source = readFileSync('src/utils/storeChannelOperations.ts', 'utf8');
  const component = readFileSync('src/components/store/StoreChannelOperationsQueue.tsx', 'utf8');
  assert.match(source, /loadMercadoLivreSyncReviewQueue/);
  assert.match(source, /loadMercadoLivreConflictResolutionQueue/);
  assert.match(source, /\/api\/integrations\/99food\/blocked-orders/);
  assert.match(source, /retry-reservation/);
  assert.match(source, /method: 'POST'/);
  assert.match(source, /Promise\.allSettled/);
  assert.doesNotMatch(source, /blocked-orders\/.*\/reject|decideMercadoLivreSyncProposal|updateStoreConnectionSyncAuthority|orders\/.*\/status/);
  assert.match(component, /Pendências dos canais/);
  assert.match(component, /Tentar reservar novamente/);
  assert.match(component, /Confirmar nova tentativa/);
  assert.match(component, /Nenhum status foi enviado à 99Food/);
});

test('99Food reservation retry stays inside canonical reservation reconciliation and never writes provider status', () => {
  const service = readFileSync('server/integrations/ninetyNineFoodOrderBlockResolutionService.ts', 'utf8');
  const retrySection = service.match(
    /export const retryNinetyNineFoodBlockedOrderReservation[\s\S]*?\n};\n\nexport const rejectNinetyNineFoodBlockedOrder/
  )?.[0] ?? '';
  assert.match(retrySection, /reconcileNinetyNineFoodOrderReservation/);
  assert.match(retrySection, /BLOCKED_STATES\.has/);
  assert.doesNotMatch(retrySection, /sendNinetyNineFoodOrderStatus|provider_write_succeeded|rejected/);
});

test('channel portal mounts the operational queue between overview and provider-specific modules', () => {
  const source = readFileSync('src/components/store/StoreConnectionsPortalBridge.tsx', 'utf8');
  const centerIndex = source.indexOf('<StoreChannelCenter');
  const queueIndex = source.indexOf('<StoreChannelOperationsQueue');
  const mercadoLivreIndex = source.indexOf('id="kyrub-mercado-livre-channel-detail"');
  assert.ok(centerIndex >= 0 && queueIndex > centerIndex && mercadoLivreIndex > queueIndex);
  assert.match(source, /id="kyrub-99food-channel-detail"/);
});
