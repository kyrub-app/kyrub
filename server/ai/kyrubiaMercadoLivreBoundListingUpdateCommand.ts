import { randomUUID } from 'node:crypto';
import type { KyrubiaTurnContext } from '../../shared/kyrubiaContext.js';
import { adminDb } from '../firebaseAdmin.js';
import { authorizeMercadoLivreBoundListingUpdate } from '../integrations/mercadoLivreBoundListingUpdateAuthorizationService.js';
import { executeAuthorizedMercadoLivreBoundListingUpdate } from '../integrations/mercadoLivreBoundListingUpdateExecutionService.js';
import { proposeMercadoLivreBoundListingUpdate } from '../integrations/mercadoLivreBoundListingUpdateProposalService.js';
import {
  isExplicitMercadoLivreBoundListingUpdateAuthorizationAttempt,
  parseExplicitMercadoLivreBoundListingUpdateAuthorization,
  parseKyrubiaMercadoLivreBoundListingUpdatePreparationCommand,
} from './kyrubiaMercadoLivreBoundListingUpdateIntent.js';

export type KyrubiaMercadoLivreBoundListingUpdateCommandResult =
  | { handled: false }
  | {
      handled: true;
      reply: string;
      turnContext: KyrubiaTurnContext;
    };

type PublishedBindingCandidate = {
  proposalId: string;
  bindingId: string;
  canonicalProductId: string;
  externalItemId: string;
};

type BoundListingUpdateContext = KyrubiaTurnContext & {
  mercadoLivreBoundListingUpdate?: {
    proposalId: string;
    bindingId: string;
    externalItemId: string;
    productId: string;
    proposalState: string;
    executionStatus: string;
    authorizationMode: 'explicit_proposal_bound';
  };
};

type StoredBoundListingUpdateProposal = {
  id: string;
  storeId: string;
  provider: 'mercado_livre';
  bindingId: string;
  externalItemId: string;
  canonicalProductId: string;
  status: string;
  executionStatus: string;
  observedExternalPrice: number;
  proposedPrice: number;
  changedFields: string[];
  protectedFields: string[];
};

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const finiteNonNegative = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const safeId = (value: string): boolean => /^[a-zA-Z0-9_-]{1,180}$/.test(value);

const proposalIdFromContext = (context?: KyrubiaTurnContext): string => {
  if (!context) return '';
  const progressProposalId = context.mercadoLivreRequirementProgress?.proposalId.trim() ?? '';
  if (progressProposalId) return progressProposalId;
  const selected = context.selectedIntent;
  if (
    selected?.intent === 'mercado_livre.category_select' ||
    selected?.intent === 'mercado_livre.condition_select' ||
    selected?.intent === 'mercado_livre.listing_type_select' ||
    selected?.intent === 'mercado_livre.attribute_value_select'
  ) {
    return selected.payload.proposalId.trim();
  }
  return '';
};

const candidateFromPublishedProposal = (
  storeId: string,
  proposalId: string,
  value: unknown
): PublishedBindingCandidate | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const bindingId = clean(record.externalCatalogBindingId, 180);
  const canonicalProductId = clean(record.canonicalProductId, 180);
  const externalItemId = clean(record.externalItemId, 180);
  if (
    record.schemaVersion !== 2 ||
    clean(record.id, 180) !== proposalId ||
    clean(record.storeId, 160) !== storeId ||
    record.provider !== 'mercado_livre' ||
    record.executionStatus !== 'published' ||
    !safeId(bindingId) ||
    !safeId(canonicalProductId) ||
    !safeId(externalItemId)
  ) return null;
  return { proposalId, bindingId, canonicalProductId, externalItemId };
};

const bindingFromConversationProposal = async (
  storeId: string,
  proposalId: string
): Promise<PublishedBindingCandidate | null> => {
  if (!safeId(proposalId)) return null;
  const snapshot = await adminDb
    .doc(`stores/${storeId}/catalogOutboundPublicationProposals/${proposalId}`)
    .get();
  if (!snapshot.exists) return null;
  return candidateFromPublishedProposal(storeId, proposalId, snapshot.data());
};

const discoverPublishedBindings = async (storeId: string): Promise<PublishedBindingCandidate[]> => {
  const snapshot = await adminDb
    .collection(`stores/${storeId}/catalogOutboundPublicationProposals`)
    .limit(100)
    .get();
  const unique = new Map<string, PublishedBindingCandidate>();
  for (const doc of snapshot.docs) {
    const candidate = candidateFromPublishedProposal(storeId, doc.id, doc.data());
    if (candidate && !unique.has(candidate.bindingId)) unique.set(candidate.bindingId, candidate);
  }
  return [...unique.values()].sort((a, b) => a.bindingId.localeCompare(b.bindingId));
};

const refreshedContext = (
  userId: string,
  candidate?: PublishedBindingCandidate,
  proposal?: {
    id: string;
    bindingId: string;
    externalItemId: string;
    canonicalProductId: string;
    status: string;
    executionStatus: string;
  }
): BoundListingUpdateContext => ({
  version: 1,
  id: randomUUID(),
  source: 'kyrub_runtime',
  sourceAction: 'operational_workflow',
  generatedAt: new Date().toISOString(),
  scope: { kind: 'own_store', storeId: userId },
  entities: candidate
    ? [{
        entityType: 'product',
        entityId: candidate.canonicalProductId,
        label: candidate.canonicalProductId,
        position: 1,
      }]
    : [],
  ...(proposal ? {
    mercadoLivreBoundListingUpdate: {
      proposalId: proposal.id,
      bindingId: proposal.bindingId,
      externalItemId: proposal.externalItemId,
      productId: proposal.canonicalProductId,
      proposalState: proposal.status,
      executionStatus: proposal.executionStatus,
      authorizationMode: 'explicit_proposal_bound' as const,
    },
  } : {}),
});

const fieldLabel = (field: 'name' | 'price'): string => field === 'name' ? 'nome' : 'preço';

const errorCode = (error: unknown): string =>
  error instanceof Error
    ? error.message.split(':')[0]
    : 'MERCADO_LIVRE_BOUND_LISTING_UPDATE_PROPOSAL_UNAVAILABLE';

const sameMoney = (left: number, right: number): boolean =>
  Math.round(left * 100) === Math.round(right * 100);

const money = (value: number): string => value.toLocaleString('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const readStoredUpdateProposal = async (
  storeId: string,
  proposalId: string
): Promise<StoredBoundListingUpdateProposal | null> => {
  if (!safeId(proposalId)) return null;
  const snapshot = await adminDb.doc(`stores/${storeId}/catalogOutboundUpdateProposals/${proposalId}`).get();
  if (!snapshot.exists) return null;
  const value = snapshot.data();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const observedExternal = record.observedExternal && typeof record.observedExternal === 'object' && !Array.isArray(record.observedExternal)
    ? record.observedExternal as Record<string, unknown>
    : {};
  const proposedChanges = record.proposedChanges && typeof record.proposedChanges === 'object' && !Array.isArray(record.proposedChanges)
    ? record.proposedChanges as Record<string, unknown>
    : {};
  const observedExternalPrice = finiteNonNegative(observedExternal.price);
  const proposedPrice = finiteNonNegative(proposedChanges.price);
  const changedFields = Array.isArray(record.changedFields)
    ? record.changedFields.map(item => clean(item, 80)).filter(Boolean)
    : [];
  const protectedFields = Array.isArray(record.protectedFields)
    ? record.protectedFields.map(item => clean(item, 80)).filter(Boolean)
    : [];
  if (
    Number(record.schemaVersion) !== 2 ||
    clean(record.id, 180) !== proposalId ||
    clean(record.storeId, 180) !== storeId ||
    record.provider !== 'mercado_livre' ||
    !safeId(clean(record.bindingId, 180)) ||
    !safeId(clean(record.externalItemId, 180)) ||
    !safeId(clean(record.canonicalProductId, 180)) ||
    observedExternalPrice === null ||
    proposedPrice === null
  ) return null;
  return {
    id: proposalId,
    storeId,
    provider: 'mercado_livre',
    bindingId: clean(record.bindingId, 180),
    externalItemId: clean(record.externalItemId, 180),
    canonicalProductId: clean(record.canonicalProductId, 180),
    status: clean(record.status, 80),
    executionStatus: clean(record.executionStatus, 80),
    observedExternalPrice,
    proposedPrice,
    changedFields,
    protectedFields,
  };
};

const proposalContextCandidate = (proposal: StoredBoundListingUpdateProposal): PublishedBindingCandidate => ({
  proposalId: '',
  bindingId: proposal.bindingId,
  canonicalProductId: proposal.canonicalProductId,
  externalItemId: proposal.externalItemId,
});

const authorizationStateReply = (proposal: StoredBoundListingUpdateProposal): string => {
  if (proposal.executionStatus === 'provider_write_succeeded') {
    return [
      `A proposta ${proposal.id} já foi executada com sucesso para o item ${proposal.externalItemId}.`,
      'Esta nova mensagem foi tratada como repetição idempotente: nenhuma nova autorização foi criada e nenhum segundo PUT /items foi enviado ao Mercado Livre.',
    ].join(' ');
  }
  return [
    `A proposta ${proposal.id} está em executionStatus=${proposal.executionStatus}.`,
    'Por segurança, o Kyrub não cria uma segunda autorização, não recupera token consumível por suposição e não repete a escrita no Mercado Livre.',
    'O estado deve ser reconciliado antes de qualquer nova tentativa.',
  ].join(' ');
};

const handleExplicitAuthorization = async (input: {
  userId: string;
  message: string;
}): Promise<Extract<KyrubiaMercadoLivreBoundListingUpdateCommandResult, { handled: true }>> => {
  const authorizationCommand = parseExplicitMercadoLivreBoundListingUpdateAuthorization(input.message);
  if (!authorizationCommand) {
    return {
      handled: true,
      turnContext: refreshedContext(input.userId),
      reply: [
        'Reconheci uma tentativa de autorizar uma proposta de atualização vinculada do Mercado Livre, mas a autorização não está completa no formato seguro.',
        'Ela precisa citar explicitamente o proposalId mlupd_…, o item MLB…, a alteração exclusivamente de preço, o valor atual e o novo valor, além de manter estoque, categoria, imagens e status da publicação protegidos.',
        'Frases genéricas como “sim”, “ok” ou “pode” não concedem autorização externa. Nenhuma autorização foi criada e nenhum PUT /items foi enviado ao Mercado Livre.',
      ].join(' '),
    };
  }

  const proposal = await readStoredUpdateProposal(input.userId, authorizationCommand.proposalId);
  if (!proposal) {
    return {
      handled: true,
      turnContext: refreshedContext(input.userId),
      reply: `A proposta ${authorizationCommand.proposalId} não foi encontrada como proposta canônica de atualização vinculada desta loja. Nenhuma autorização foi criada e nenhum PUT /items foi enviado ao Mercado Livre.`,
    };
  }
  const nextContext = refreshedContext(input.userId, proposalContextCandidate(proposal), proposal);

  const protectedSet = new Set(proposal.protectedFields);
  const isPriceOnly = proposal.status === 'review_required' &&
    proposal.changedFields.length === 1 &&
    proposal.changedFields[0] === 'price' &&
    protectedSet.has('stock') &&
    protectedSet.has('category') &&
    protectedSet.has('image') &&
    protectedSet.has('publicationStatus');
  const commandMatchesProposal =
    authorizationCommand.externalItemId === proposal.externalItemId &&
    sameMoney(authorizationCommand.fromPrice, proposal.observedExternalPrice) &&
    sameMoney(authorizationCommand.toPrice, proposal.proposedPrice);

  if (!isPriceOnly || !commandMatchesProposal) {
    return {
      handled: true,
      turnContext: nextContext,
      reply: [
        `A autorização não corresponde exatamente à proposta ${proposal.id}.`,
        `O servidor exige o item ${proposal.externalItemId}, preço observado R$ ${money(proposal.observedExternalPrice)} e preço proposto R$ ${money(proposal.proposedPrice)}, com somente o campo preço autorizado.`,
        'Estoque, categoria, imagens e status continuam protegidos. Nenhuma autorização foi criada e nenhum PUT /items foi enviado ao Mercado Livre.',
      ].join(' '),
    };
  }

  if (proposal.executionStatus !== 'not_authorized') {
    return {
      handled: true,
      turnContext: nextContext,
      reply: authorizationStateReply(proposal),
    };
  }

  try {
    const authorization = await authorizeMercadoLivreBoundListingUpdate({
      storeId: input.userId,
      proposalId: proposal.id,
      authorizedByUserId: input.userId,
    });
    const execution = await executeAuthorizedMercadoLivreBoundListingUpdate({
      storeId: input.userId,
      authorizationId: authorization.authorizationId,
      authorizationToken: authorization.authorizationToken,
      executedByUserId: input.userId,
    });
    const completedProposal: StoredBoundListingUpdateProposal = {
      ...proposal,
      executionStatus: execution.status,
    };
    return {
      handled: true,
      turnContext: refreshedContext(input.userId, proposalContextCandidate(proposal), completedProposal),
      reply: [
        `Autorização explícita vinculada à proposta ${proposal.id} validada e consumida uma única vez.`,
        `A atualização do item ${execution.externalItemId} foi concluída com executionStatus=${execution.status}: preço de R$ ${money(proposal.observedExternalPrice)} para R$ ${money(proposal.proposedPrice)}.`,
        'Antes da escrita, o servidor releu e revalidou a proposta, o binding, o produto canônico e o estado atual do Mercado Livre.',
        'Estoque, categoria, imagens e status da publicação permaneceram fora do payload autorizado.',
      ].join(' '),
    };
  } catch (error) {
    const current = await readStoredUpdateProposal(input.userId, proposal.id).catch(() => null);
    const state = current?.executionStatus || proposal.executionStatus;
    return {
      handled: true,
      turnContext: refreshedContext(
        input.userId,
        proposalContextCandidate(current ?? proposal),
        current ?? { ...proposal, executionStatus: state }
      ),
      reply: [
        `A autorização explícita da proposta ${proposal.id} foi bloqueada/interrompida pelo gate autoritativo (${errorCode(error)}).`,
        `O estado persistido conhecido agora é executionStatus=${state}.`,
        state === 'not_authorized'
          ? 'Nenhuma escrita externa foi autorizada.'
          : 'O Kyrub não fará retry cego nem uma segunda escrita; este estado precisa ser reconciliado antes de nova tentativa.',
      ].join(' '),
    };
  }
};

export const handleKyrubiaMercadoLivreBoundListingUpdateCommand = async (input: {
  userId: string;
  message: string;
  context?: KyrubiaTurnContext;
}): Promise<KyrubiaMercadoLivreBoundListingUpdateCommandResult> => {
  if (isExplicitMercadoLivreBoundListingUpdateAuthorizationAttempt(input.message)) {
    return handleExplicitAuthorization({ userId: input.userId, message: input.message });
  }

  const command = parseKyrubiaMercadoLivreBoundListingUpdatePreparationCommand(input.message);
  if (!command) return { handled: false };

  let candidate: PublishedBindingCandidate | undefined;
  let bindingId = command.requestedBindingId?.trim() ?? '';

  if (!bindingId) {
    const contextualProposalId = proposalIdFromContext(input.context);
    if (contextualProposalId) {
      candidate = await bindingFromConversationProposal(input.userId, contextualProposalId) ?? undefined;
      bindingId = candidate?.bindingId ?? '';
    }
  }

  if (!bindingId) {
    try {
      const candidates = await discoverPublishedBindings(input.userId);
      if (candidates.length === 0) {
        return {
          handled: true,
          turnContext: refreshedContext(input.userId),
          reply: [
            'O comando para preparar uma atualização do Mercado Livre foi reconhecido, mas não encontrei nenhuma publicação reconciliada e vinculada elegível nesta conta.',
            'O Kyrub não escolheu um anúncio por suposição, não recorreu à IA genérica e não enviou nenhuma alteração ao Mercado Livre.',
          ].join(' '),
        };
      }
      if (candidates.length > 1) {
        const visible = candidates.slice(0, 8)
          .map((item, index) => `${index + 1}) binding ${item.bindingId} · produto ${item.canonicalProductId} · item ${item.externalItemId}`)
          .join('; ');
        return {
          handled: true,
          turnContext: refreshedContext(input.userId),
          reply: [
            'O comando para preparar uma atualização do Mercado Livre foi reconhecido, mas existe mais de uma publicação vinculada elegível.',
            `Encontrei: ${visible}.`,
            `Escolha explicitamente um binding, por exemplo: “Preparar atualização da publicação ID ${candidates[0].bindingId}”.`,
            'O Kyrub não escolheu nenhum automaticamente e não enviou nenhuma alteração ao Mercado Livre.',
          ].join(' '),
        };
      }
      candidate = candidates[0];
      bindingId = candidate.bindingId;
    } catch (error) {
      return {
        handled: true,
        turnContext: refreshedContext(input.userId),
        reply: `O comando para preparar a atualização foi reconhecido, mas a recuperação autoritativa do binding falhou (${errorCode(error)}). Nenhuma alteração foi enviada ao Mercado Livre.`,
      };
    }
  }

  if (!safeId(bindingId)) {
    return {
      handled: true,
      turnContext: refreshedContext(input.userId),
      reply: 'O binding informado não possui um identificador válido. O Kyrub não tentou adivinhar outro binding e não enviou nenhuma alteração ao Mercado Livre.',
    };
  }

  try {
    const proposal = await proposeMercadoLivreBoundListingUpdate({
      storeId: input.userId,
      bindingId,
      proposedByUserId: input.userId,
    });
    const proposalCandidate = candidate ?? {
      proposalId: '',
      bindingId: proposal.bindingId,
      canonicalProductId: proposal.canonicalProductId,
      externalItemId: proposal.externalItemId,
    };
    const nextContext = refreshedContext(input.userId, proposalCandidate, proposal);
    const priceEvidence = `Evidência de preço usada neste gate: produto canônico ${proposal.canonicalProductId}; baseline R$ ${proposal.baseline.price}; Kyrub atual R$ ${proposal.currentCanonical.price}; Mercado Livre atual R$ ${proposal.observedExternal.price}.`;

    if (proposal.status === 'no_changes') {
      return {
        handled: true,
        turnContext: nextContext,
        reply: [
          `A verificação de atualização foi concluída para o item ${proposal.externalItemId} no binding ${proposal.bindingId}.`,
          'Nome e preço do produto canônico não apresentam nenhuma mudança real a enviar em relação à baseline reconciliada e à leitura atual do Mercado Livre.',
          priceEvidence,
          `O registro ${proposal.id} ficou como no_changes e executionStatus=not_authorized.`,
          'Estoque, categoria, imagem e status da publicação permanecem fora desta autoridade de atualização.',
          'Nenhuma autorização foi criada e nenhum PUT /items foi enviado ao Mercado Livre.',
        ].join(' '),
      };
    }

    const changes = proposal.changedFields.map(field => fieldLabel(field)).join(' e ');
    return {
      handled: true,
      turnContext: nextContext,
      reply: [
        `Preparei a proposta ${proposal.id} para atualizar ${changes} do item ${proposal.externalItemId}.`,
        `Ela está review_required e executionStatus=not_authorized no binding ${proposal.bindingId}.`,
        'A proposta foi calculada comparando a baseline reconciliada, o produto canônico atual do Kyrub e uma nova leitura do anúncio no Mercado Livre.',
        priceEvidence,
        `A intenção persistida nesta conversa está vinculada exatamente ao proposalId ${proposal.id}; confirmações genéricas não concedem autoridade externa.`,
        'Estoque, categoria, imagem e status da publicação estão explicitamente protegidos e não fazem parte desta proposta.',
        'Nenhuma autorização de atualização foi criada e nenhum PUT /items foi enviado ao Mercado Livre.',
      ].join(' '),
    };
  } catch (error) {
    return {
      handled: true,
      turnContext: refreshedContext(input.userId, candidate),
      reply: [
        `O comando para preparar a atualização foi reconhecido, mas o gate autoritativo bloqueou a proposta (${errorCode(error)}).`,
        'O Kyrub não substituiu evidência persistida por contexto de conversa, não recorreu à IA genérica e não enviou nenhuma alteração ao Mercado Livre.',
      ].join(' '),
    };
  }
};
