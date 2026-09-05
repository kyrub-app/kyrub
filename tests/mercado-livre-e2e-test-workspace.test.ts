import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildMercadoLivreInitialPublicationPayload } from '../server/integrations/mercadoLivreInitialPublicationPayloadAdapter.js';

// This regression file is intentionally part of prebuild so every preview contains the complete merchant E2E bench.
const servicePath = new URL('../server/integrations/mercadoLivreE2ETestService.ts', import.meta.url);
const capabilityServicePath = new URL('../server/integrations/mercadoLivrePublicationCapabilityService.ts', import.meta.url);
const routerPath = new URL('../server/integrations/mercadoLivreE2ETestRouter.ts', import.meta.url);
const componentPath = new URL('../src/components/store/MercadoLivreE2ETestWorkspace.tsx', import.meta.url);
const bridgePath = new URL('../src/components/store/StoreConnectionsPortalBridge.tsx', import.meta.url);
const clientPath = new URL('../src/utils/mercadoLivreE2ETest.ts', import.meta.url);
const serverPath = new URL('../server.ts', import.meta.url);
const kyrubiaChatPath = new URL('../server/ai/kyrubiaUserProviderChatService.ts', import.meta.url);
const kyrubiaAttributeCollectorPath = new URL('../server/ai/kyrubiaMercadoLivreRequiredAttributeCollector.ts', import.meta.url);
const kyrubiaAttributePlannerPath = new URL('../server/ai/kyrubiaMercadoLivreRequiredAttributePlanner.ts', import.meta.url);
const kyrubiaContextPath = new URL('../shared/kyrubiaContext.ts', import.meta.url);
const offeredIntentRuntimePath = new URL('../src/ai/offeredIntentRuntime.ts', import.meta.url);

test('E2E helper only lists canonical eligible products and provider requirement options', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /stores\/\$\{canonicalStoreId\}\/products/);
  assert.match(source, /externalCatalogBindings/);
  assert.match(source, /catalogOutboundRequirementInspections/);
  assert.match(source, /MERCADO_LIVRE_OUTBOUND_CATEGORY_NOT_PREDICTED/);
  assert.match(source, /provider_api_requirement_options/);
  assert.doesNotMatch(source, /mercadoLivrePutJson|mercadoLivrePostJson/);
});

test('publication capability supports User Products but still fails closed for warehouse stock', async () => {
  const source = await readFile(capabilityServicePath, 'utf8');
  assert.match(source, /user_product_seller/);
  assert.match(source, /warehouse_management/);
  assert.match(source, /multiwarehouse/);
  assert.doesNotMatch(source, /user_products_publication_adapter_required/);
  assert.match(source, /stock_locations_adapter_required/);
  assert.match(source, /ready_current_adapter/);
  assert.match(source, /adapter_migration_required/);
  assert.match(source, /mercadoLivreGetJson/);
  assert.doesNotMatch(source, /mercadoLivrePostJson|mercadoLivrePutJson|fetch\s*\(/);
});

test('initial publication adapter separates legacy title from User Products family_name', () => {
  const common = {
    stockAuthority: 'item_available_quantity' as const,
    name: 'Violão Yamaha C40',
    categoryId: 'MLB123',
    price: 600,
    currencyId: 'BRL',
    availableQuantity: 1,
    listingTypeId: 'gold_special',
    condition: 'used',
    pictureUrl: 'https://example.com/guitar.jpg',
    attributes: [{ id: 'BRAND', valueName: 'Yamaha' }],
    sellerCustomField: 'kyrub-test',
  };
  const legacy = buildMercadoLivreInitialPublicationPayload({
    ...common,
    publicationModel: 'legacy_items',
  });
  assert.equal(legacy.title, 'Violão Yamaha C40');
  assert.equal('family_name' in legacy, false);

  const userProducts = buildMercadoLivreInitialPublicationPayload({
    ...common,
    publicationModel: 'user_products',
  });
  assert.equal(userProducts.family_name, 'Violão Yamaha C40');
  assert.equal('title' in userProducts, false);
  assert.equal('variations' in userProducts, false);
});

test('initial publication adapter refuses warehouse-managed stock until its dedicated adapter exists', () => {
  assert.throws(() => buildMercadoLivreInitialPublicationPayload({
    publicationModel: 'user_products',
    stockAuthority: 'stock_locations',
    name: 'Violão Yamaha C40',
    categoryId: 'MLB123',
    price: 600,
    currencyId: 'BRL',
    availableQuantity: 1,
    listingTypeId: 'gold_special',
    condition: 'used',
    attributes: [],
  }), /MERCADO_LIVRE_STOCK_LOCATION_PUBLICATION_ADAPTER_REQUIRED/);
});

test('publication capability binds provider seller identity to the connected ML account', async () => {
  const source = await readFile(capabilityServicePath, 'utf8');
  assert.match(source, /observedSellerId !== externalAccountId/);
  assert.match(source, /MERCADO_LIVRE_SELLER_IDENTITY_MISMATCH/);
  assert.match(source, /getStoreConnectionRegistryRecord/);
  assert.match(source, /connection\.provider !== 'mercado_livre'/);
  assert.match(source, /connection\.status !== 'connected'/);
});

test('E2E read router is owner authenticated and mounted beside Mercado Livre routes', async () => {
  const router = await readFile(routerPath, 'utf8');
  const server = await readFile(serverPath, 'utf8');
  assert.match(router, /authenticatedOwner/);
  assert.match(router, /e2e\/publication-capability/);
  assert.match(router, /inspectMercadoLivrePublicationCapability/);
  assert.match(router, /e2e\/eligible-products/);
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

test('Cairubia required attribute collection is session-only intent context', async () => {
  const context = await readFile(kyrubiaContextPath, 'utf8');
  const chat = await readFile(kyrubiaChatPath, 'utf8');
  assert.match(context, /mercado_livre\.attribute_value_select/);
  assert.match(context, /mercadoLivreRequirementProgress/);
  assert.match(context, /authorization: 'intent_only'/);
  assert.match(context, /providerAuthority: 'provider_api_requirement_options'/);
  assert.match(chat, /startMercadoLivreRequiredAttributeCollection/);
  assert.match(chat, /continueMercadoLivreRequiredAttributeCollection/);
  assert.match(chat, /withAttributeCollectorStep/);
});

test('Cairubia attribute collector delegates required/new-required planning and revalidates provider state every turn', async () => {
  const collector = await readFile(kyrubiaAttributeCollectorPath, 'utf8');
  const planner = await readFile(kyrubiaAttributePlannerPath, 'utf8');
  assert.match(collector, /planKyrubiaMercadoLivreRequiredAttributes/);
  assert.match(collector, /const plan = planFor\(input\.progress, input\.options, baseCollected\)/);
  assert.match(planner, /attribute\.required \|\|/);
  assert.match(planner, /condition === 'new' && attribute\.newRequired/);
  assert.match(collector, /inspectMercadoLivreRequirementCategoryOptions/);
  assert.match(collector, /assertTupleCurrent/);
  assert.match(collector, /canonicalCollected/);
  assert.match(collector, /MERCADO_LIVRE_ATTRIBUTE_PROGRESS_CONDITION_STALE/);
  assert.match(collector, /MERCADO_LIVRE_ATTRIBUTE_PROGRESS_LISTING_TYPE_STALE/);
  assert.match(collector, /MERCADO_LIVRE_ATTRIBUTE_VALUE_STALE/);
});

test('enumerated Mercado Livre attribute values are exact intent-only choices bound to the listing tuple', async () => {
  const collector = await readFile(kyrubiaAttributeCollectorPath, 'utf8');
  assert.match(collector, /intent: 'mercado_livre\.attribute_value_select'/);
  assert.match(collector, /proposalId: progress\.proposalId/);
  assert.match(collector, /categoryId: progress\.categoryId/);
  assert.match(collector, /condition: progress\.condition/);
  assert.match(collector, /listingTypeId: progress\.listingTypeId/);
  assert.match(collector, /attributeId: attribute\.id/);
  assert.match(collector, /valueId: value\.id/);
  assert.match(collector, /authorization: 'intent_only'/);
  assert.match(collector, /normalize\(value\.name\) === wanted/);
});

test('free-text attribute answers remain conversational and no requirement configuration is written', async () => {
  const collector = await readFile(kyrubiaAttributeCollectorPath, 'utf8');
  const chat = await readFile(kyrubiaChatPath, 'utf8');
  assert.match(collector, /valueName: text/);
  assert.match(collector, /nada será gravado no rascunho ainda/i);
  assert.doesNotMatch(collector, /configureMercadoLivreOutboundRequirements/);
  assert.doesNotMatch(collector, /adminDb|FieldValue|runTransaction|transaction\.(?:set|update|delete)/);
  assert.doesNotMatch(collector, /mercadoLivrePostJson|mercadoLivrePutJson|authorizeMercadoLivre|executeMercadoLivre/);
  assert.doesNotMatch(chat, /configureMercadoLivreOutboundRequirements/);
  assert.doesNotMatch(chat, /mercadoLivrePostJson|mercadoLivrePutJson|authorizeMercadoLivre|executeMercadoLivre/);
});

test('conditional attributes are collected only after official provider inspection and are re-established every turn', async () => {
  const collector = await readFile(kyrubiaAttributeCollectorPath, 'utf8');
  const chat = await readFile(kyrubiaChatPath, 'utf8');
  assert.match(collector, /inspectMercadoLivreConditionalRequirements/);
  assert.match(collector, /recoverProviderAuthorizedConditionalState/);
  assert.match(collector, /inspection\.missingConditionalAttributeIds/);
  assert.match(collector, /MERCADO_LIVRE_ATTRIBUTE_PROGRESS_CONDITIONAL_STALE/);
  assert.match(collector, /inspeção oficial \/attributes\/conditional/i);
  assert.match(collector, /nenhum RequirementConfiguration foi criado/i);
  assert.match(chat, /await startMercadoLivreRequiredAttributeCollection/);
  assert.match(chat, /userId: user\.uid/);
  assert.doesNotMatch(collector, /ready:\s*true/);
});

test('plan offered-intent runtime cannot consume Mercado Livre attribute answers', async () => {
  const runtime = await readFile(offeredIntentRuntimePath, 'utf8');
  assert.match(runtime, /offeredIntent\.intent === 'mercado_livre\.attribute_value_select'/);
  assert.match(runtime, /return null/);
});