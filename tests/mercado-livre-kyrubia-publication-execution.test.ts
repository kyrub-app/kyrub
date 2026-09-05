import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const contextPath = new URL('../shared/kyrubiaContext.ts', import.meta.url);
const chatPath = new URL('../server/ai/kyrubiaUserProviderChatService.ts', import.meta.url);
const commandPath = new URL('../server/ai/kyrubiaMercadoLivrePublicationExecutionCommand.ts', import.meta.url);
const gatePath = new URL('../server/ai/kyrubiaMercadoLivreListingValidationCommand.ts', import.meta.url);
const bridgePath = new URL('../server/integrations/mercadoLivreKyrubiaPublicationExecutionService.ts', import.meta.url);
const executorPath = new URL('../server/integrations/mercadoLivreOutboundPublicationExecutionService.ts', import.meta.url);

test('Cairubia turn context has a typed server-issued one-time publication capability', async () => {
  const context = await readFile(contextPath, 'utf8');
  const chat = await readFile(chatPath, 'utf8');
  assert.match(context, /KyrubiaMercadoLivrePublicationAuthorizationContinuation/);
  assert.match(context, /authorizationSource: 'kyrubia_explicit_owner_command'/);
  assert.match(context, /transport: 'server_issued_one_time_capability'/);
  assert.match(context, /mercadoLivrePublicationAuthorization\?:/);
  assert.match(chat, /normalizePublicationAuthorization/);
  assert.match(chat, /proposalId !== expectedProposalId/);
  assert.match(chat, /\^mlpub_\[a-f0-9\]\{32\}\$/i);
  assert.match(chat, /\[A-Za-z0-9_-\]\{43\}/);
  assert.match(chat, /sourceAction === 'mercado_livre_publication_preparation'/);
});

test('publication execution requires the exact publish-now command and the same proposal capability', async () => {
  const command = await readFile(commandPath, 'utf8');
  assert.match(command, /\^\(\?:publicar\|publique\)\\s\+agora\$/i);
  assert.match(command, /authorization\.proposalId !== proposalId/);
  assert.match(command, /authorizationSource !== 'kyrubia_explicit_owner_command'/);
  assert.match(command, /transport !== 'server_issued_one_time_capability'/);
  assert.match(command, /authorization\.expiresAtMillis <= Date\.now\(\)/);
  assert.doesNotMatch(command, /\b(?:sim|pode|ok)\b.*isExplicitPublicationExecutionCommand/i);
});

test('Cairubia execution bridge accepts only Cairubia authorization and validation provenance', async () => {
  const bridge = await readFile(bridgePath, 'utf8');
  assert.match(bridge, /authorization\.authorizationSource !== 'kyrubia_explicit_owner_command'/);
  assert.match(bridge, /authorization\.listingValidationSource !== 'kyrubia_revalidated_draft'/);
  assert.match(bridge, /proposal\.publicationAuthorizationSource !== 'kyrubia_explicit_owner_command'/);
  assert.match(bridge, /validation\.validationSource !== 'kyrubia_revalidated_draft'/);
  assert.match(bridge, /validation\.providerStatus !== 204/);
  assert.match(bridge, /executeAuthorizedMercadoLivrePublication/);
  assert.doesNotMatch(bridge, /mercadoLivrePostJson|mercadoLivrePutJson/);
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

test('publish-now consumes the existing executor once and clears the bearer capability afterwards', async () => {
  const command = await readFile(commandPath, 'utf8');
  const gate = await readFile(gatePath, 'utf8');
  const executor = await readFile(executorPath, 'utf8');
  assert.match(gate, /handleKyrubiaMercadoLivrePublicationExecutionCommand/);
  assert.match(command, /executeKyrubiaMercadoLivrePublication/);
  assert.match(command, /mercadoLivrePublicationAuthorization: undefined/);
  assert.match(command, /não pode ser reutilizado/i);
  assert.equal(executor.match(/mercadoLivrePostJson<MercadoLivreCreatedItem>\(storeId, '\/items'/g)?.length, 1);
});

test('execution replies distinguish published, rejected, reconciliation and pre-reservation blocking', async () => {
  const command = await readFile(commandPath, 'utf8');
  const bridge = await readFile(bridgePath, 'utf8');
  assert.match(command, /Publicação concluída no Mercado Livre/);
  assert.match(command, /reconciliation_required/);
  assert.match(command, /rejeitou definitivamente/);
  assert.match(command, /bloqueado antes de uma execução confirmada/);
  assert.match(bridge, /MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_RECONCILIATION_REQUIRED/);
  assert.match(bridge, /MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_PROVIDER_REJECTED/);
  assert.match(bridge, /MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_BLOCKED_BEFORE_RESERVATION/);
});
