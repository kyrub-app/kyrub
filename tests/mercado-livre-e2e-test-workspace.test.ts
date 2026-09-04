import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// This regression file is intentionally part of prebuild so every preview contains the complete merchant E2E bench.
const servicePath = new URL('../server/integrations/mercadoLivreE2ETestService.ts', import.meta.url);
const routerPath = new URL('../server/integrations/mercadoLivreE2ETestRouter.ts', import.meta.url);
const sellerCapabilityPath = new URL('../server/integrations/mercadoLivreSellerCapabilityService.ts', import.meta.url);
const publicationAuthorizationPath = new URL('../server/integrations/mercadoLivreOutboundPublicationAuthorizationService.ts', import.meta.url);
const publicationExecutionPath = new URL('../server/integrations/mercadoLivreOutboundPublicationExecutionService.ts', import.meta.url);
const componentPath = new URL('../src/components/store/MercadoLivreE2ETestWorkspace.tsx', import.meta.url);
const bridgePath = new URL('../src/components/store/StoreConnectionsPortalBridge.tsx', import.meta.url);
const clientPath = new URL('../src/utils/mercadoLivreE2ETest.ts', import.meta.url);
const serverPath = new URL('../server.ts', import.meta.url);

test('E2E helper only lists canonical eligible products and provider requirement options', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /stores\/\$\{canonicalStoreId\}\/products/);
  assert.match(source, /externalCatalogBindings/);
  assert.match(source, /catalogOutboundRequirementInspections/);
  assert.match(source, /MERCADO_LIVRE_OUTBOUND_CATEGORY_NOT_PREDICTED/);
  assert.match(source, /provider_api_requirement_options/);
  assert.doesNotMatch(source, /mercadoLivrePutJson|mercadoLivrePostJson/);
});

test('seller publication capability is derived from authenticated Mercado Livre profile and fails closed on identity drift', async () => {
  const source = await readFile(sellerCapabilityPath, 'utf8');
  assert.match(source, /\/users\/\$\{encodeURIComponent\(providerUserId\)\}/);
  assert.match(source, /user_product_seller/);
  assert.match(source, /warehouse_management/);
  assert.match(source, /publicationModel/);
  assert.match(source, /legacy_items/);
  assert.match(source, /user_products/);
  assert.match(source, /multi_origin_seller_warehouse/);
  assert.match(source, /capabilityFingerprint/);
  assert.match(source, /MERCADO_LIVRE_SELLER_CAPABILITY_IDENTITY_MISMATCH/);
  assert.match(source, /mercado_livre_authenticated_user_profile/);
  assert.doesNotMatch(source, /mercadoLivrePutJson|mercadoLivrePostJson|\.create\(|\.set\(|\.update\(/);
});

test('legacy publication authority freezes capability and execution rechecks it before the provider write', async () => {
  const authorization = await readFile(publicationAuthorizationPath, 'utf8');
  const execution = await readFile(publicationExecutionPath, 'utf8');
  assert.match(authorization, /inspectMercadoLivreSellerCapability/);
  assert.match(authorization, /MERCADO_LIVRE_USER_PRODUCTS_ADAPTER_REQUIRED/);
  assert.match(authorization, /providerCapabilityFingerprint/);
  assert.match(authorization, /providerPublicationModel/);
  assert.match(execution, /inspectMercadoLivreSellerCapability/);
  assert.match(execution, /MERCADO_LIVRE_PUBLICATION_PROVIDER_CAPABILITY_STALE/);
  assert.match(execution, /safeHashEquals\(authorization\.providerCapabilityFingerprint, providerCapability\.capabilityFingerprint\)/);
  assert.match(execution, /mercadoLivrePostJson<.*>\(storeId, '\/items'/);
  assert.ok(execution.indexOf('MERCADO_LIVRE_PUBLICATION_PROVIDER_CAPABILITY_STALE') < execution.indexOf("mercadoLivrePostJson<MercadoLivreCreatedItem>(storeId, '/items'"));
});

test('E2E read router is owner authenticated and mounted beside Mercado Livre routes', async () => {
  const router = await readFile(routerPath, 'utf8');
  const server = await readFile(serverPath, 'utf8');
  assert.match(router, /authenticatedOwner/);
  assert.match(router, /e2e\/eligible-products/);
  assert.match(router, /e2e\/seller-capability/);
  assert.match(router, /inspectMercadoLivreSellerCapability/);
  assert.match(router, /category-options/);
  assert.match(server, /createMercadoLivreE2ETestRouter/);
  assert.match(server, /\/api\/store-connections\/mercado-livre/);
});

test('merchant E2E workspace separates preparation from the two real provider writes', async () => {
  const source = await readFile(componentPath, 'utf8');
  assert.match(source, /Preparar publicação/);
  assert.match(source, /Validar com Mercado Livre/);
  assert.match(source, /Autorizar publicação real/);
  assert.match(source, /Publicar agora/);
  assert.match(source, /Autorizar alteração real de estoque/);
  assert.match(source, /Alterar estoque agora/);
  assert.match(source, /Confirmar anúncio no Mercado Livre/);
  assert.match(source, /Confirmar estoque no Mercado Livre/);
});

test('one-time publication and stock tokens stay in React state only', async () => {
  const source = await readFile(componentPath, 'utf8');
  assert.match(source, /publicationAuthorization/);
  assert.match(source, /stockAuthorization/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|setDoc|addDoc|updateDoc/);
});

test('client uses frozen authorization routes and channel availability boundary', async () => {
  const source = await readFile(clientPath, 'utf8');
  assert.match(source, /authorize-publication/);
  assert.match(source, /outbound-publication-authorizations/);
  assert.match(source, /outbound-stock-authorizations/);
  assert.match(source, /outbound-stock-executions/);
  assert.match(source, /\/api\/orders\/availability/);
});

test('E2E workspace is mounted through the existing store connections portal', async () => {
  const source = await readFile(bridgePath, 'utf8');
  assert.match(source, /MercadoLivreE2ETestBridge/);
  assert.match(source, /StoreConnectionsWorkspace/);
});
