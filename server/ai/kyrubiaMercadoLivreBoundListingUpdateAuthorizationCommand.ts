import { randomUUID } from 'node:crypto';
import type { KyrubAiConsultantResponse } from '../../shared/aiConsultant.js';
import { evaluateExternalWriteAuthorizationRequest } from '../../shared/externalWriteGovernance.js';
import { adminDb } from '../firebaseAdmin.js';
import { authorizeMercadoLivreBoundListingUpdate } from '../integrations/mercadoLivreBoundListingUpdateAuthorizationService.js';
import { executeAuthorizedMercadoLivreBoundListingUpdate } from '../integrations/mercadoLivreBoundListingUpdateExecutionService.js';
import { reconcileMercadoLivreBoundListingUpdate } from '../integrations/mercadoLivreBoundListingUpdateReconciliationService.js';
import { authenticateConsultantRequest } from './consultantAuth.js';

const clean = (value: unknown, maximum = 240): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const finiteNonNegative = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const currencyValue = (value: string): number | null => {
  const compact = value.replace(/\s+/g, '').replace(/\./g, '').replace(',', '.');
  return finiteNonNegative(compact);
};

const normalized = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('pt-BR')
  .replace(/\s+/g, ' ')
  .trim();

export interface KyrubiaMercadoLivreBoundUpdateAuthorizationCommand {
  proposalId: string;
  externalItemId: string;
  fromPrice: number;
  toPrice: number;
}

export const extractKyrubiaMercadoLivreBoundUpdateAuthorizationCommand = (
  message: string
): KyrubiaMercadoLivreBoundUpdateAuthorizationCommand | null => {
  const text = clean(message, 2_000);
  const semantic = normalized(text);
  if (!/\bautoriz(?:o|ar|e)\b/i.test(semantic)) return null;

  const proposalId = clean(/\b(mlupd_[a-f0-9]{16,64})\b/i.exec(text)?.[1], 160);
  const externalItemId = clean(/\b(MLB\d{5,})\b/i.exec(text)?.[1], 160).toUpperCase();
  const prices = /\bde\s+R\$\s*([\d.,]+)\s+para\s+R\$\s*([\d.,]+)/i.exec(text);
  const fromPrice = prices ? currencyValue(prices[1]) : null;
  const toPrice = prices ? currencyValue(prices[2]) : null;
  const explicitPriceOnly = /\b(?:exclusivamente|somente|apenas)\s+(?:o\s+)?preco\b/.test(semantic);

  if (!proposalId || !externalItemId || fromPrice === null || toPrice === null || !explicitPriceOnly) return null;
  if (fromPrice === toPrice) return null;

  return { proposalId, externalItemId, fromPrice, toPrice };
};

export const isKyrubiaMercadoLivreBoundUpdateAuthorizationCandidate = (
  message: string
): boolean => /\bmlupd_[a-f0-9]{16,64}\b/i.test(message) && /\bautoriz/i.test(normalized(message));

type ProposalSnapshot = {
  id: string;
  storeId: string;
  provider: string;
  externalItemId: string;
  status: string;
  executionStatus: string;
  changedFields: string[];
  proposedChanges: Record<string, unknown>;
  observedExternal: Record<string, unknown>;
  protectedFields: string[];
  updateExecutionId: string;
};

const proposalSnapshot = (value: unknown): ProposalSnapshot | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  return {
    id: clean(raw.id, 160),
    storeId: clean(raw.storeId, 160),
    provider: clean(raw.provider, 80),
    externalItemId: clean(raw.externalItemId, 160).toUpperCase(),
    status: clean(raw.status, 80),
    executionStatus: clean(raw.executionStatus, 80),
    changedFields: Array.isArray(raw.changedFields) ? raw.changedFields.map(item => clean(item, 80)).filter(Boolean) : [],
    proposedChanges: raw.proposedChanges && typeof raw.proposedChanges === 'object' && !Array.isArray(raw.proposedChanges)
      ? raw.proposedChanges as Record<string, unknown>
      : {},
    observedExternal: raw.observedExternal && typeof raw.observedExternal === 'object' && !Array.isArray(raw.observedExternal)
      ? raw.observedExternal as Record<string, unknown>
      : {},
    protectedFields: Array.isArray(raw.protectedFields) ? raw.protectedFields.map(item => clean(item, 80)).filter(Boolean) : [],
    updateExecutionId: clean(raw.updateExecutionId, 180),
  };
};

const capabilities: KyrubAiConsultantResponse['capabilities'] = {
  actionsEnabled: true,
  enabledActions: [],
  enabledReadActions: [],
  voiceEnabled: false,
  persistentCloudHistoryEnabled: false,
};

const response = (reply: string): KyrubAiConsultantResponse => ({
  reply,
  provider: 'kyrub',
  model: 'kyrub-mercado-livre-bound-update-runtime-v1',
  mode: 'deterministic',
  requestId: randomUUID(),
  capabilities,
});

const commandMismatchReply = (code: string): KyrubAiConsultantResponse => response([
  `A autorização de atualização vinculada foi bloqueada (${code}).`,
  'Para alterar o Mercado Livre, a mensagem precisa autorizar explicitamente a proposta mlupd_..., identificar o item MLB... e declarar exclusivamente a mudança de preço de um valor para outro.',
  '“Sim”, “ok”, “pode” ou apenas salvar o produto no Kyrub não constituem autorização para alterar o canal externo.',
  'Nenhuma chamada de atualização foi enviada ao Mercado Livre.',
].join(' '));

export const handleKyrubiaMercadoLivreBoundUpdateAuthorizationCommand = async (input: {
  authorization: string;
  message: string;
}): Promise<KyrubAiConsultantResponse | null> => {
  if (!isKyrubiaMercadoLivreBoundUpdateAuthorizationCandidate(input.message)) return null;

  const command = extractKyrubiaMercadoLivreBoundUpdateAuthorizationCommand(input.message);
  if (!command) return commandMismatchReply('EXPLICIT_AUTHORIZATION_REQUIRED');

  const user = await authenticateConsultantRequest(input.authorization);
  const proposalRef = adminDb.doc(`stores/${user.uid}/catalogOutboundUpdateProposals/${command.proposalId}`);
  const proposalDoc = await proposalRef.get();
  if (!proposalDoc.exists) return commandMismatchReply('PROPOSAL_NOT_FOUND');
  const proposal = proposalSnapshot(proposalDoc.data());
  if (!proposal) return commandMismatchReply('PROPOSAL_INVALID');

  const proposedPrice = finiteNonNegative(proposal.proposedChanges.price);
  const observedPrice = finiteNonNegative(proposal.observedExternal.price);
  const protectedSet = new Set(proposal.protectedFields);
  const exactPriceOnly = proposal.changedFields.length === 1 && proposal.changedFields[0] === 'price';
  const protectedScope = ['stock', 'category', 'image', 'publicationStatus'].every(field => protectedSet.has(field));
  if (
    proposal.id !== command.proposalId ||
    proposal.storeId !== user.uid ||
    proposal.provider !== 'mercado_livre' ||
    proposal.externalItemId !== command.externalItemId ||
    proposal.status !== 'review_required' ||
    !exactPriceOnly ||
    !protectedScope ||
    proposedPrice !== command.toPrice ||
    observedPrice !== command.fromPrice
  ) return commandMismatchReply('PROPOSAL_SCOPE_MISMATCH');

  const governance = evaluateExternalWriteAuthorizationRequest({
    request: {
      storeId: user.uid,
      channel: 'mercado_livre',
      operationKind: 'catalog.bound_listing.price_update',
      proposalId: command.proposalId,
      targetRef: command.externalItemId,
    },
    userSignal: 'explicit_authorization',
    authorizedFields: proposal.changedFields,
    protectedFields: proposal.protectedFields,
  });
  if (!governance.allowed) {
    return commandMismatchReply(`EXTERNAL_WRITE_GOVERNANCE_${governance.code}`);
  }

  if (proposal.executionStatus === 'reconciled') {
    return response(
      `A proposta ${command.proposalId} já foi executada e reconciliada anteriormente para o item ${command.externalItemId}. Não enviei uma segunda atualização ao Mercado Livre.`
    );
  }

  if (proposal.executionStatus === 'provider_write_succeeded' && proposal.updateExecutionId) {
    const reconciliation = await reconcileMercadoLivreBoundListingUpdate({
      storeId: user.uid,
      executionId: proposal.updateExecutionId,
      reconciledByUserId: user.uid,
    });
    return response(
      reconciliation.status === 'reconciled'
        ? `A proposta ${command.proposalId} já havia sido aplicada ao item ${command.externalItemId} e agora foi reconciliada sem repetir a escrita no Mercado Livre.`
        : `A proposta ${command.proposalId} já havia sido enviada ao item ${command.externalItemId}, mas a releitura do Mercado Livre ainda não confirmou o alvo autorizado. Não repeti a escrita; o caso ficou como reconciliation_required.`
    );
  }

  if (proposal.executionStatus !== 'not_authorized') {
    return commandMismatchReply(`PROPOSAL_STATE_${proposal.executionStatus || 'UNKNOWN'}`);
  }

  const authorization = await authorizeMercadoLivreBoundListingUpdate({
    storeId: user.uid,
    proposalId: command.proposalId,
    authorizedByUserId: user.uid,
  });
  const execution = await executeAuthorizedMercadoLivreBoundListingUpdate({
    storeId: user.uid,
    authorizationId: authorization.authorizationId,
    authorizationToken: authorization.authorizationToken,
    executedByUserId: user.uid,
  });
  const reconciliation = await reconcileMercadoLivreBoundListingUpdate({
    storeId: user.uid,
    executionId: execution.executionId,
    reconciledByUserId: user.uid,
  });

  if (reconciliation.status !== 'reconciled') {
    return response([
      `A proposta ${command.proposalId} consumiu a autorização explícita para alterar exclusivamente o preço do item ${command.externalItemId} de R$ ${command.fromPrice.toFixed(2).replace('.', ',')} para R$ ${command.toPrice.toFixed(2).replace('.', ',')}.`,
      'A escrita foi enviada uma única vez, mas a releitura autoritativa do Mercado Livre ainda não confirmou o alvo; marquei o fluxo como reconciliation_required e não farei retry cego.',
      'Estoque, categoria, imagens e status não fazem parte do payload autorizado.',
    ].join(' '));
  }

  return response([
    `Autorização explícita ${authorization.authorizationId} consumida para a proposta ${command.proposalId}.`,
    `O item ${command.externalItemId} foi atualizado exclusivamente no preço, de R$ ${command.fromPrice.toFixed(2).replace('.', ',')} para R$ ${command.toPrice.toFixed(2).replace('.', ',')}, e a releitura do Mercado Livre foi reconciliada.`,
    'Estoque, categoria, imagens e status permaneceram fora do payload autorizado.',
    `Execução ${execution.executionId}.`,
  ].join(' '));
};
