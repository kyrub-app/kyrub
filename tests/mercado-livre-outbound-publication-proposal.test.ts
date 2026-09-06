import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildMercadoLivreInitialPublicationPayload } from '../server/integrations/mercadoLivreInitialPublicationPayloadAdapter';

const servicePath = new URL('../server/integrations/mercadoLivreOutboundPublicationService.ts', import.meta.url);
const capabilityPath = new URL('../server/integrations/mercadoLivrePublicationCapabilityService.ts', import.meta.url);
const routerPath = new URL('../server/integrations/mercadoLivreRouter.ts', import.meta.url);
const kyrubiaDraftPath = new URL('../server/integrations/mercadoLivreKyrubiaDraftConfigurationService.ts', import.meta.url);
const kyrubiaValidationPath = new URL('../server/integrations/mercadoLivreKyrubiaListingValidationService.ts', import.meta.url);
const genericValidationPath = new URL('../server/integrations/mercadoLivreOutboundListingValidationService.ts', import.meta.url);
const authorizationPath = new URL('../server/integrations/mercadoLivreOutboundPublicationAuthorizationService.ts', import.meta.url);
const executionPath = new URL('../server/integrations/mercadoLivreOutboundPublicationExecutionService.ts', import.meta.url);

const threePictures = [
  'https://cdn.kyrub.test/chaveiro-1.png',
  'https://cdn.kyrub.test/chaveiro-2.png',
  'https://cdn.kyrub.test/chaveiro-3.png',
];

test('outbound publication starts as a non-executable owner-reviewed proposal', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /status: 'review_required'/);
  assert.match(source, /authority: 'canonical_kyrub_snapshot'/);
  assert.match(source, /action: 'create_external_listing'/);
  assert.match(source, /executionStatus: 'not_authorized'/);
  assert.match(source, /syncAuthority !== 'manual_review'/);
  assert.match(source, /canonicalBaselineHash/);
  assert.match(source, /mercado_livre_category_id/);
  assert.match(source, /listing_type_id/);
  assert.match(source, /required_attributes/);
  assert.doesNotMatch(source, /mercadoLivrePostJson|\/items['"`]/);
});

test('outbound proposal resolves the canonical store instead of assuming owner store identity', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /users\/\$\{storeId\}\/stores\/\$\{storeId\}/);
  assert.match(source, /canonicalStoreId/);
  assert.match(source, /stores\/\$\{canonicalStoreId\}\/products\/\$\{canonicalProductId\}/);
  assert.doesNotMatch(source, /stores\/\$\{storeId\}\/products\/\$\{canonicalProductId\}/);
  assert.match(source, /proposalIdFor\(/);
  assert.match(source, /baselineHash,/);
  assert.match(source, /providerCapabilitySnapshot\.fingerprint/);
});

test('proposal freezes either legacy or User Products provider model before authorization', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /inspectMercadoLivrePublicationCapability/);
  assert.match(source, /freezeMercadoLivrePublicationCapability/);
  assert.match(source, /readiness !== 'ready_current_adapter'/);
  assert.match(source, /MERCADO_LIVRE_OUTBOUND_PUBLICATION_ADAPTER_MIGRATION_REQUIRED/);
  assert.doesNotMatch(source, /publicationModel !== 'legacy_items'/);
  assert.match(source, /stockAuthority !== 'item_available_quantity'/);
  assert.match(source, /MERCADO_LIVRE_STOCK_LOCATION_PUBLICATION_ADAPTER_REQUIRED/);
  assert.match(source, /schemaVersion: 2/);
  assert.match(source, /providerCapabilityFingerprint/);
  assert.match(source, /providerPublicationModel/);
  assert.match(source, /providerStockAuthority/);
  assert.match(source, /providerCapability: providerCapabilitySnapshot/);
  assert.match(source, /publicationModel === 'user_products'/);
  assert.match(source, /familyName: product\.name/);
});

test('Mercado Livre payload preserves all unique canonical product pictures in order', () => {
  const payload = buildMercadoLivreInitialPublicationPayload({
    publicationModel: 'legacy_items',
    stockAuthority: 'item_available_quantity',
    name: 'Chaveiro Kyrub',
    categoryId: 'MLB123',
    price: 29.9,
    currencyId: 'BRL',
    availableQuantity: 10,
    listingTypeId: 'gold_special',
    condition: 'new',
    pictureUrl: threePictures[0],
    pictureUrls: [...threePictures, threePictures[1]],
    attributes: [],
  });

  assert.deepEqual(payload.pictures, threePictures.map(source => ({ source })));
});

test('User Products payload keeps the same multi-picture set without reintroducing legacy title', () => {
  const payload = buildMercadoLivreInitialPublicationPayload({
    publicationModel: 'user_products',
    stockAuthority: 'item_available_quantity',
    name: 'Chaveiro Kyrub',
    categoryId: 'MLB123',
    price: 29.9,
    currencyId: 'BRL',
    availableQuantity: 10,
    listingTypeId: 'gold_special',
    condition: 'new',
    pictureUrls: threePictures,
    attributes: [],
  });

  assert.equal(payload.family_name, 'Chaveiro Kyrub');
  assert.equal('title' in payload, false);
  assert.deepEqual(payload.pictures, threePictures.map(source => ({ source })));
});

test('full canonical image set is frozen and revalidated through every publication gate', async () => {
  const [proposal, draft, kyrubiaValidation, genericValidation, authorization, execution] = await Promise.all([
    readFile(servicePath, 'utf8'),
    readFile(kyrubiaDraftPath, 'utf8'),
    readFile(kyrubiaValidationPath, 'utf8'),
    readFile(genericValidationPath, 'utf8'),
    readFile(authorizationPath, 'utf8'),
    readFile(executionPath, 'utf8'),
  ]);

  assert.match(proposal, /images: product\.images/);
  assert.match(proposal, /pictureUrls: product\.images/);
  assert.match(proposal, /images: product\.images,[\s\S]*isService/);
  assert.match(draft, /sameJson\(canonicalImages\(record\.images, image\), proposal\.canonical\.images\)/);
  assert.match(kyrubiaValidation, /pictureUrls: proposal\.canonical\.images/);
  assert.match(kyrubiaValidation, /sameJson\(canonicalImages\(record\.images, image\), proposal\.canonical\.images\)/);
  assert.match(genericValidation, /pictureUrls: proposal\.canonical\.images/);
  assert.match(authorization, /sameJson\(canonicalImages\(record\.images, image\), proposal\.canonical\.images\)/);
  assert.match(execution, /images: canonicalImages\(record\.images, image\)/);
  assert.match(execution, /mercadoLivrePostJson<MercadoLivreCreatedItem>\(storeId, '\/items', authorization\.payload\)/);
  assert.doesNotMatch(proposal, /mercadoLivrePostJson/);
  assert.doesNotMatch(kyrubiaValidation, /mercadoLivrePostJson/);
  assert.doesNotMatch(authorization, /mercadoLivrePostJson/);
});

test('capability fingerprint is based only on material seller publication and stock authority', async () => {
  const source = await readFile(capabilityPath, 'utf8');
  assert.match(source, /materialCapabilityState/);
  assert.match(source, /mercadoLivrePublicationCapabilityFingerprint/);
  assert.match(source, /freezeMercadoLivrePublicationCapability/);
  assert.match(source, /externalAccountId: capability\.externalAccountId/);
  assert.match(source, /publicationModel: capability\.publicationModel/);
  assert.match(source, /stockAuthority: capability\.stockAuthority/);
  assert.match(source, /warehouseMode: capability\.warehouseMode/);
  const materialState = source.slice(
    source.indexOf('const materialCapabilityState'),
    source.indexOf('export const mercadoLivrePublicationCapabilityFingerprint')
  );
  assert.doesNotMatch(materialState, /observedAt|nickname|observedTags/);
});

test('outbound proposal routes remain owner authenticated and do not publish', async () => {
  const source = await readFile(routerPath, 'utf8');
  assert.match(source, /outbound-publication-proposals/);
  assert.match(source, /authenticatedOwner/);
  assert.match(source, /proposeMercadoLivreExternalPublication/);
  assert.doesNotMatch(source, /publishMercadoLivre|createMercadoLivreListing/);
});
