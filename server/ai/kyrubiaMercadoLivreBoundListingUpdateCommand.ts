import { randomUUID } from 'node:crypto';
import type { KyrubiaTurnContext } from '../../shared/kyrubiaContext.js';
import { adminDb } from '../firebaseAdmin.js';
import { proposeMercadoLivreBoundListingUpdate } from '../integrations/mercadoLivreBoundListingUpdateProposalService.js';

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

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const safeId = (value: string): boolean => /^[a-zA-Z0-9_-]{1,180}$/.test(value);

const normalizeExplicitCommand = (message: string): string =>
  message.trim().replace(/[.!?…]+$/u, '').trim();

const parseExplicitBoundUpdateCommand = (message: string): { requestedBindingId?: string } | null => {
  const normalized = normalizeExplicitCommand(message);
  const match = /^(?:preparar|prepare)(?:\s+a)?\s+atualiza(?:ção|cao)\s+(?:(?:da|de)\s+publica(?:ção|cao)|do\s+an[uú]ncio)(?:\s+id\s+([a-zA-Z0-9_-]{1,180}))?$/i.exec(normalized);
  if (!match) return null;
  return match[1] ? { requestedBindingId: match[1] } : {};
};

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
  context: KyrubiaTurnContext | undefined,
  candidate?: PublishedBindingCandidate
): KyrubiaTurnContext => {
  if (context) {
    return {
      ...context,
      id: randomUUID(),
      generatedAt: new Date().toISOString(),
      offeredIntents: undefined,
      mercadoLivreRequirementProgress: undefined,
    };
  }
  return {
    version: 1,
    id: randomUUID(),
    source: 'kyrub_runtime',
    sourceAction: 'mercado_livre_publication_preparation',
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
  };
};

const fieldLabel = (field: 'name' | 'price'): string => field === 'name' ? 'nome' : 'preço';

const errorCode = (error: unknown): string =>
  error instanceof Error
    ? error.message.split(':')[0]
    : 'MERCADO_LIVRE_BOUND_LISTING_UPDATE_PROPOSAL_UNAVAILABLE';

export const handleKyrubiaMercadoLivreBoundListingUpdateCommand = async (input: {
  userId: string;
  message: string;
  context?: KyrubiaTurnContext;
}): Promise<KyrubiaMercadoLivreBoundListingUpdateCommandResult> => {
  const command = parseExplicitBoundUpdateCommand(input.message);
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
          turnContext: refreshedContext(input.userId, input.context),
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
          turnContext: refreshedContext(input.userId, input.context),
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
        turnContext: refreshedContext(input.userId, input.context),
        reply: `O comando para preparar a atualização foi reconhecido, mas a recuperação autoritativa do binding falhou (${errorCode(error)}). Nenhuma alteração foi enviada ao Mercado Livre.`,
      };
    }
  }

  if (!safeId(bindingId)) {
    return {
      handled: true,
      turnContext: refreshedContext(input.userId, input.context),
      reply: 'O binding informado não possui um identificador válido. O Kyrub não tentou adivinhar outro binding e não enviou nenhuma alteração ao Mercado Livre.',
    };
  }

  try {
    const proposal = await proposeMercadoLivreBoundListingUpdate({
      storeId: input.userId,
      bindingId,
      proposedByUserId: input.userId,
    });
    const nextContext = refreshedContext(input.userId, input.context, candidate ?? {
      proposalId: '',
      bindingId: proposal.bindingId,
      canonicalProductId: proposal.canonicalProductId,
      externalItemId: proposal.externalItemId,
    });
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
        'Estoque, categoria, imagem e status da publicação estão explicitamente protegidos e não fazem parte desta proposta.',
        'Nenhuma autorização de atualização foi criada e nenhum PUT /items foi enviado ao Mercado Livre.',
      ].join(' '),
    };
  } catch (error) {
    return {
      handled: true,
      turnContext: refreshedContext(input.userId, input.context, candidate),
      reply: [
        `O comando para preparar a atualização foi reconhecido, mas o gate autoritativo bloqueou a proposta (${errorCode(error)}).`,
        'O Kyrub não substituiu evidência persistida por contexto de conversa, não recorreu à IA genérica e não enviou nenhuma alteração ao Mercado Livre.',
      ].join(' '),
    };
  }
};
