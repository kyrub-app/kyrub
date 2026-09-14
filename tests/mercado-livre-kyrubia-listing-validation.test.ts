import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildMercadoLivreInitialPublicationPayload } from '../server/integrations/mercadoLivreInitialPublicationPayloadAdapter.js';

const servicePath = new URL('../server/integrations/mercadoLivreKyrubiaListingValidationService.ts', import.meta.url);
const transportPath = new URL('../server/integrations/mercadoLivreListingValidationTransport.ts', import.meta.url);
const commandPath = new URL('../server/ai/kyrubiaMercadoLivreListingValidationCommand.ts', import.meta.url);
const chatPath = new URL('../server/ai/kyrubiaUserProviderChatService.ts', import.meta.url);
const readinessPath = new URL('../server/integrations/mercadoLivreKyrubiaCommercialReadinessService.ts', import.meta.url);
const commercialConfigurationPath = new URL('../server/integrations/mercadoLivreOutboundCommercialConfigurationService.ts', import.meta.url);

test('Cairubia listing validation only accepts its persisted schema-v2 draft evidence', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /record\.schemaVersion !== 2/);
  assert.match(source, /configurationSource !== 'kyrubia_revalidated_session'/);
  assert.match(source, /validationSource !== 'preconfiguration_provider_api_conditional_inspection'/);
  assert.match(source, /record\.ready !== true/);
  assert.match(source, /proposal\.providerCategoryId/);
  assert.match(source, /proposal\.providerListingTypeId/);
  assert.match(source, /proposal\.providerCondition/);
  assert.match(source, /proposal\.providerCurrencyId/);
  assert.match(source, /providerCapabilityFingerprint/);
  assert.match(source, /canonicalMatchesProposal/);
});

test('Cairubia validates the final payload through items validate without publishing', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /buildMercadoLivreInitialPublicationPayload/);
  assert.match(source, /mercadoLivreValidateJson/);
  assert.match(source, /from '\.\/mercadoLivreListingValidationTransport\.js'/);
  assert.doesNotMatch(source, /from '\.\/mercadoLivreOauthService\.js'/);
  assert.match(source, /'\/items\/validate'/);
  assert.match(source, /ready_for_owner_authorization/);
  assert.match(source, /needs_correction/);
  assert.match(source, /executionStatus: 'not_authorized'/);
  assert.match(source, /publicationReadinessAuthority: 'provider_items_validate'/);
  assert.match(source, /publicationValidationSource: 'kyrubia_revalidated_draft'/);
  assert.match(source, /catalogOutboundCommercialConfigurations/);
  assert.match(source, /saleTerms: commercialConfiguration\?\.saleTerms \?\? \[\]/);
  assert.match(source, /shipping: commercialConfiguration\?\.shipping \?\? null/);
  assert.match(source, /commercialRequirementConfiguredAt/);
  assert.doesNotMatch(source, /mercadoLivrePostJson|mercadoLivrePutJson/);
  assert.doesNotMatch(source, /catalogOutboundPublicationAuthorizations|authorizationToken|tokenHash/);
});

test('ME2 listing validation payload keeps the explicit empty free methods list expected by Mercado Livre', () => {
  const payload = buildMercadoLivreInitialPublicationPayload({
    publicationModel: 'user_products',
    stockAuthority: 'item_available_quantity',
    name: 'Squeeze 480ml Dobrável Laranja com Mosquetão',
    familyName: 'Squeeze 480ml Dobrável Laranja com Mosquetão',
    categoryId: 'MLB9908',
    price: 10,
    currencyId: 'BRL',
    availableQuantity: 1,
    listingTypeId: 'gold_special',
    condition: 'new',
    attributes: [],
    shipping: {
      mode: 'me2',
      freeShipping: false,
      localPickUp: false,
    },
  });

  assert.deepEqual(payload.shipping, {
    mode: 'me2',
    free_shipping: false,
    local_pick_up: false,
    free_methods: [],
  });
});

test('listing validation transport records safe provider diagnostics for blocked HTTP responses', async () => {
  const transport = await readFile(transportPath, 'utf8');
  assert.match(transport, /\[Mercado Livre listing validation rejection\]/);
  assert.match(transport, /\[Mercado Livre listing validation diagnostic\]/);
  assert.match(transport, /requestShippingDiagnostic/);
  assert.match(transport, /providerCauseDiagnostics/);
  assert.match(transport, /freeMethodsCount/);
  assert.match(transport, /record\.type \?\? record\.severity \?\? record\.level/);
  assert.match(transport, /providerDiagnostic\(payload\)/);
  assert.match(transport, /Bearer \[redacted\]/);
  assert.match(transport, /\[email\]/);
  assert.match(transport, /MERCADO_LIVRE_API_FAILED:HTTP_/);
  assert.doesNotMatch(transport, /console\.info\([^\n]*body/);
});

test('listing validation command is explicit and uses conversation context only as a locator', async () => {
  const command = await readFile(commandPath, 'utf8');
  assert.match(command, /\^\(\?:validar\|valide\)/);
  assert.match(command, /sourceAction !== 'mercado_livre_publication_preparation'/);
  assert.match(command, /selectedIntent\?\.intent !== 'mercado_livre\.listing_type_select'/);
  assert.match(command, /validateKyrubiaMercadoLivreDraftListing/);
  assert.match(command, /Nenhuma autorização de publicação foi criada/i);
  assert.match(command, /executionStatus continua not_authorized/);
  assert.doesNotMatch(command, /\b(?:sim|pode|ok)\b.*isExplicitDraftValidationCommand/i);
});

test('Kairuba preflights provider shipping before items validate and never invents a seller mode', async () => {
  const command = await readFile(commandPath, 'utf8');
  const readiness = await readFile(readinessPath, 'utf8');
  const commercialConfiguration = await readFile(commercialConfigurationPath, 'utf8');
  const readinessCall = command.indexOf('inspectKyrubiaMercadoLivreCommercialReadiness({');
  const validationCall = command.lastIndexOf('validateKyrubiaMercadoLivreDraftListing({');

  assert.ok(readinessCall >= 0);
  assert.ok(validationCall > readinessCall);
  assert.match(command, /parseShippingCommand/);
  assert.match(command, /Configurar frete/);
  assert.match(command, /allowedShippingModes\.includes\(shippingCommand\.mode\)/);
  assert.match(command, /configureMercadoLivreOutboundCommercialRequirements/);
  assert.match(command, /O Kyrub não chamou \/items\/validate/);
  assert.match(command, /Nada foi gravado, validado, autorizado ou publicado/);
  assert.match(readiness, /inspectMercadoLivreCommercialRequirements/);
  assert.match(readiness, /provider_api_commercial_options/);
  assert.match(readiness, /missingRequiredSaleTermIds/);
  assert.match(commercialConfiguration, /transaction\.delete\(listingValidationRef\)/);
  assert.match(commercialConfiguration, /publicationReadiness: FieldValue\.delete\(\)/);
});

test('after draft configuration Cairubia preserves only the listing locator and offers validation as a separate gate', async () => {
  const chat = await readFile(chatPath, 'utf8');
  assert.match(chat, /sourceAction: 'mercado_livre_publication_preparation'/);
  assert.match(chat, /mercadoLivreRequirementProgress: undefined/);
  assert.doesNotMatch(chat, /selectedIntent: undefined/);
  assert.match(chat, /diga exatamente “Validar draft”/);
  assert.match(chat, /handleKyrubiaMercadoLivreListingValidationCommand/);
  assert.match(chat, /listingValidationCommand\.handled/);
});