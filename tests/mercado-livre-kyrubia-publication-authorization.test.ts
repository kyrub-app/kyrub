import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const servicePath = new URL('../server/integrations/mercadoLivreKyrubiaPublicationAuthorizationService.ts', import.meta.url);
const commandPath = new URL('../server/ai/kyrubiaMercadoLivreListingValidationCommand.ts', import.meta.url);

test('Cairubia publication authorization requires the exact schema-v2 validation produced by its own gate', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /record\.schemaVersion !== 2/);
  assert.match(source, /publicationReadiness !== 'ready_for_owner_authorization'/);
  assert.match(source, /publicationReadinessAuthority !== 'provider_items_validate'/);
  assert.match(source, /publicationValidationSource !== 'kyrubia_revalidated_draft'/);
  assert.match(source, /record\.providerStatus !== 204/);
  assert.match(source, /record\.validationSource !== 'kyrubia_revalidated_draft'/);
  assert.match(source, /record\.executionStatus !== 'not_authorized'/);
  assert.match(source, /requirementConfiguredAt/);
  assert.match(source, /conditionalRequirementValidatedAt/);
});

test('authorization rechecks provider capability and canonical product before creating a one-time capability', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /assertCurrentMercadoLivrePublicationCapability/);
  assert.match(source, /canonicalMatchesProposal/);
  assert.match(source, /randomBytes\(32\)/);
  assert.match(source, /tokenHash = sha256\(authorizationToken\)/);
  assert.match(source, /Date\.now\(\) \+ 15 \* 60 \* 1000/);
  assert.match(source, /catalogOutboundPublicationAuthorizations/);
  assert.match(source, /consumptionStatus: 'available'/);
  assert.match(source, /useCount: 0/);
  assert.match(source, /authorizationSource: 'kyrubia_explicit_owner_command'/);
  assert.match(source, /executionStatus: 'authorized'/);
});

test('authorization is atomic and never performs the Mercado Livre item write', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /adminDb\.runTransaction/);
  assert.match(source, /transaction\.create\(authorizationRef/);
  assert.match(source, /transaction\.update\(proposalRef/);
  assert.doesNotMatch(source, /mercadoLivrePostJson|mercadoLivrePutJson|mercadoLivreValidateJson/);
  assert.doesNotMatch(source, /['"]\/items['"]/);
});

test('Cairubia accepts only the explicit owner authorization phrase and keeps the secret out of the reply text', async () => {
  const command = await readFile(commandPath, 'utf8');
  assert.match(command, /\^\(\?:autorizar\|autorize\)/);
  assert.match(command, /authorizeKyrubiaMercadoLivrePublication/);
  assert.match(command, /mercadoLivrePublicationAuthorization/);
  assert.match(command, /transport: 'server_issued_one_time_capability'/);
  assert.match(command, /O segredo dessa capability não é exibido na conversa/);
  assert.doesNotMatch(command, /reply:[\s\S]{0,1000}authorization\.authorizationToken/);
  assert.doesNotMatch(command, /\b(?:sim|pode|ok)\b.*isExplicitPublicationAuthorizationCommand/i);
});

test('successful provider validation now points to authorization as a separate non-publication gate', async () => {
  const command = await readFile(commandPath, 'utf8');
  assert.match(command, /diga exatamente “Autorizar publicação”/);
  assert.match(command, /Esse comando ainda não publica o item/);
  assert.match(command, /Autorizar ainda não publica/);
  assert.match(command, /nenhum POST \/items foi executado/);
});
