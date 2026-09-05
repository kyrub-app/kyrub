import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const servicePath = new URL('../server/integrations/mercadoLivreKyrubiaListingValidationService.ts', import.meta.url);
const commandPath = new URL('../server/ai/kyrubiaMercadoLivreListingValidationCommand.ts', import.meta.url);
const chatPath = new URL('../server/ai/kyrubiaUserProviderChatService.ts', import.meta.url);

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
  assert.match(source, /'\/items\/validate'/);
  assert.match(source, /ready_for_owner_authorization/);
  assert.match(source, /needs_correction/);
  assert.match(source, /executionStatus: 'not_authorized'/);
  assert.match(source, /publicationReadinessAuthority: 'provider_items_validate'/);
  assert.match(source, /publicationValidationSource: 'kyrubia_revalidated_draft'/);
  assert.doesNotMatch(source, /mercadoLivrePostJson|mercadoLivrePutJson/);
  assert.doesNotMatch(source, /catalogOutboundPublicationAuthorizations|authorizationToken|tokenHash/);
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

test('after draft configuration Cairubia preserves only the listing locator and offers validation as a separate gate', async () => {
  const chat = await readFile(chatPath, 'utf8');
  assert.match(chat, /sourceAction: 'mercado_livre_publication_preparation'/);
  assert.match(chat, /mercadoLivreRequirementProgress: undefined/);
  assert.doesNotMatch(chat, /selectedIntent: undefined/);
  assert.match(chat, /diga exatamente “Validar draft”/);
  assert.match(chat, /handleKyrubiaMercadoLivreListingValidationCommand/);
  assert.match(chat, /listingValidationCommand\.handled/);
});
