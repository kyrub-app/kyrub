import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const commandPath = new URL('../server/ai/kyrubiaMercadoLivrePublicationExecutionCommand.ts', import.meta.url);
const gatePath = new URL('../server/ai/kyrubiaMercadoLivreListingValidationCommand.ts', import.meta.url);
const authorizationPath = new URL('../server/integrations/mercadoLivreKyrubiaPublicationAuthorizationService.ts', import.meta.url);
const bridgePath = new URL('../server/integrations/mercadoLivreKyrubiaPublicationExecutionService.ts', import.meta.url);
const executorPath = new URL('../server/integrations/mercadoLivreOutboundPublicationExecutionService.ts', import.meta.url);
const routerPath = new URL('../server/integrations/mercadoLivreRouter.ts', import.meta.url);

test('Cairubia publish-now carries only the proposal locator and never a raw authorization token', async () => {
  const command = await readFile(commandPath, 'utf8');
  const gate = await readFile(gatePath, 'utf8');
  const authorization = await readFile(authorizationPath, 'utf8');
  assert.match(command, /selectedIntent\?\.intent === 'mercado_livre\.listing_type_select'/);
  assert.match(command, /proposalId/);
  assert.match(command, /mercadoLivrePublicationAuthorization: undefined/);
  assert.doesNotMatch(command, /authorizationToken/);
  assert.doesNotMatch(gate, /authorizationToken/);
  assert.doesNotMatch(authorization, /authorizationToken/);
  assert.match(authorization, /authorizationSecret = randomBytes\(32\)/);
  assert.match(authorization, /tokenHash = sha256\(authorizationSecret\)/);
});

test('publication execution requires the exact publish-now command and resolves authority on the server', async () => {
  const command = await readFile(commandPath, 'utf8');
  const bridge = await readFile(bridgePath, 'utf8');
  assert.match(command, /\^\(\?:publicar\|publique\)\\s\+agora\$/i);
  assert.match(command, /executeKyrubiaMercadoLivrePublication/);
  assert.match(bridge, /proposalAuthorizationId/);
  assert.match(bridge, /proposal\.publicationAuthorizationSource !== 'kyrubia_explicit_owner_command'/);
  assert.match(bridge, /publicationAuthorizedByUserId/);
  assert.doesNotMatch(command, /\b(?:sim|pode|ok)\b.*isExplicitPublicationExecutionCommand/i);
});

test('Cairubia execution bridge accepts only Cairubia authorization and validation provenance', async () => {
  const bridge = await readFile(bridgePath, 'utf8');
  const executor = await readFile(executorPath, 'utf8');
  assert.match(bridge, /authorization\.authorizationSource !== 'kyrubia_explicit_owner_command'/);
  assert.match(bridge, /authorization\.listingValidationSource !== 'kyrubia_revalidated_draft'/);
  assert.match(bridge, /proposal\.publicationAuthorizationSource !== 'kyrubia_explicit_owner_command'/);
  assert.match(bridge, /validation\.validationSource !== 'kyrubia_revalidated_draft'/);
  assert.match(bridge, /validation\.providerStatus !== 204/);
  assert.match(bridge, /serverExecutionAuthority: 'kyrubia_explicit_publish_now_command'/);
  assert.match(bridge, /expectedProposalId: proposalId/);
  assert.match(bridge, /expectedAuthorizationSource: 'kyrubia_explicit_owner_command'/);
  assert.match(bridge, /expectedValidationSource: 'kyrubia_revalidated_draft'/);
  assert.match(executor, /serverExecutionAuthority\?: 'kyrubia_explicit_publish_now_command'/);
  assert.match(executor, /hasKyrubiaServerAuthority/);
  assert.match(executor, /currentAuthorization\.authorizationSource !== expectedAuthorizationSource/);
  assert.match(executor, /proposal\.publicationAuthorizationSource !== expectedAuthorizationSource/);
  assert.match(executor, /currentAuthorization\.listingValidationSource !== expectedValidationSource/);
  assert.match(executor, /validation\?\.validationSource !== expectedValidationSource/);
  assert.match(executor, /publicationAuthorizedByUserId/);
  assert.match(bridge, /executeAuthorizedMercadoLivrePublication/);
  assert.doesNotMatch(bridge, /mercadoLivrePostJson|mercadoLivrePutJson/);
});

test('legacy execution endpoint still requires the raw bearer token and cannot select server execution authority', async () => {
  const router = await readFile(routerPath, 'utf8');
  const executor = await readFile(executorPath, 'utf8');
  assert.match(router, /outbound-publication-authorizations\/:authorizationId\/execute/);
  assert.match(router, /authorizationToken:\s*clean\(request\.body\?\.authorizationToken\)/);
  assert.doesNotMatch(router, /serverExecutionAuthority|expectedProposalId/);
  assert.match(executor, /\(!authorizationToken && !hasKyrubiaServerAuthority\)/);
  assert.match(executor, /safeHashEquals\(authorization\.tokenHash, sha256\(authorizationToken\)\)/);
});

test('Cairubia server authority is rechecked in the atomic reservation transaction', async () => {
  const executor = await readFile(executorPath, 'utf8');
  const reserveIndex = executor.indexOf("consumptionStatus: 'executing'");
  const serverProofIndex = executor.indexOf('hasKyrubiaServerAuthority &&');
  const providerPostIndex = executor.indexOf("mercadoLivrePostJson<MercadoLivreCreatedItem>(storeId, '/items'");
  assert.ok(serverProofIndex >= 0);
  assert.ok(reserveIndex > serverProofIndex);
  assert.ok(providerPostIndex > reserveIndex);
  assert.match(executor, /currentAuthorization\.proposalId !== expectedProposalId/);
  assert.match(executor, /currentAuthorization\.authorizedByUserId/);
  assert.match(executor, /proposal\.publicationAuthorizedByUserId/);
  assert.match(executor, /executionSource: serverExecutionAuthority/);
});

test('expired Cairubia authorization is revoked and requires fresh provider validation', async () => {
  const bridge = await readFile(bridgePath, 'utf8');
  const command = await readFile(commandPath, 'utf8');
  assert.match(bridge, /resetExpiredAuthorizationForRevalidation/);
  assert.match(bridge, /consumptionStatus: 'expired'/);
  assert.match(bridge, /executionStatus: 'not_authorized'/);
  assert.match(bridge, /publicationReadiness: FieldValue\.delete\(\)/);
  assert.match(bridge, /publicationValidationSource: FieldValue\.delete\(\)/);
  assert.match(bridge, /publicationAuthorizationId: FieldValue\.delete\(\)/);
  assert.match(bridge, /MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_AUTHORIZATION_EXPIRED_REVALIDATION_REQUIRED/);
  assert.match(command, /Diga novamente “Validar draft”/);
  assert.match(command, /“Autorizar publicação”/);
});

test('unconfirmed execution after reservation is forced into reconciliation and never retried', async () => {
  const bridge = await readFile(bridgePath, 'utf8');
  assert.match(bridge, /executionStatus === 'published'/);
  assert.match(bridge, /executionStatus === 'provider_rejected'/);
  assert.match(bridge, /executionStatus === 'reconciliation_required'/);
  assert.match(bridge, /executionStatus !== 'executing'/);
  assert.match(bridge, /kyrubia_unconfirmed_after_execution_reservation/);
  assert.match(bridge, /consumptionStatus: 'reconciliation_required'/);
  assert.match(bridge, /executionStatus: 'reconciliation_required'/);
  assert.doesNotMatch(bridge, /retry|RETRY|setTimeout/);
});

test('publish-now delegates to the existing single provider executor and never duplicates the item write', async () => {
  const command = await readFile(commandPath, 'utf8');
  const gate = await readFile(gatePath, 'utf8');
  const bridge = await readFile(bridgePath, 'utf8');
  const executor = await readFile(executorPath, 'utf8');
  assert.match(gate, /handleKyrubiaMercadoLivrePublicationExecutionCommand/);
  assert.match(command, /executeKyrubiaMercadoLivrePublication/);
  assert.match(bridge, /executeAuthorizedMercadoLivrePublication/);
  assert.equal(executor.match(/mercadoLivrePostJson<MercadoLivreCreatedItem>\(storeId, '\/items'/g)?.length, 1);
  assert.doesNotMatch(bridge, /mercadoLivrePostJson|mercadoLivrePutJson/);
});

test('execution replies distinguish published, expired, rejected, reconciliation and pre-reservation blocking', async () => {
  const command = await readFile(commandPath, 'utf8');
  const bridge = await readFile(bridgePath, 'utf8');
  assert.match(command, /Publicação concluída no Mercado Livre/);
  assert.match(command, /autorização de 15 minutos expirou/i);
  assert.match(command, /reconciliation_required/);
  assert.match(command, /rejeitou definitivamente/);
  assert.match(command, /bloqueado antes de uma execução confirmada/);
  assert.match(bridge, /MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_AUTHORIZATION_EXPIRED_REVALIDATION_REQUIRED/);
  assert.match(bridge, /MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_RECONCILIATION_REQUIRED/);
  assert.match(bridge, /MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_PROVIDER_REJECTED/);
  assert.match(bridge, /MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_BLOCKED_BEFORE_RESERVATION/);
});
