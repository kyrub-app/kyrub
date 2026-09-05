import { randomUUID } from 'node:crypto';
import type { KyrubiaTurnContext } from '../../shared/kyrubiaContext.js';
import { validateKyrubiaMercadoLivreDraftListing } from '../integrations/mercadoLivreKyrubiaListingValidationService.js';

export type KyrubiaMercadoLivreListingValidationCommandResult =
  | { handled: false }
  | {
      handled: true;
      reply: string;
      turnContext: KyrubiaTurnContext;
    };

const isExplicitDraftValidationCommand = (message: string): boolean =>
  /^(?:validar|valide)(?:\s+o)?\s+(?:draft|rascunho)$/i.test(message.trim());

const proposalIdFromPreparationContext = (
  context: KyrubiaTurnContext
): string => {
  if (
    context.sourceAction !== 'mercado_livre_publication_preparation' ||
    context.mercadoLivreRequirementProgress ||
    context.selectedIntent?.intent !== 'mercado_livre.listing_type_select'
  ) {
    return '';
  }
  return context.selectedIntent.payload.proposalId.trim();
};

const refreshedPreparationContext = (
  context: KyrubiaTurnContext
): KyrubiaTurnContext => ({
  ...context,
  id: randomUUID(),
  sourceAction: 'mercado_livre_publication_preparation',
  generatedAt: new Date().toISOString(),
  offeredIntents: undefined,
  mercadoLivreRequirementProgress: undefined,
});

const compactCause = (
  cause: { code: string; message: string; reference: string }
): string => {
  const parts = [cause.code, cause.message, cause.reference].filter(Boolean);
  return parts.join(' — ');
};

const unavailableReply = (error: unknown): string => {
  const code = error instanceof Error
    ? error.message.split(':')[0]
    : 'MERCADO_LIVRE_KYRUBIA_LISTING_VALIDATION_UNAVAILABLE';
  return [
    `O comando “Validar draft” foi reconhecido, mas o gate autoritativo bloqueou a validação (${code}).`,
    'O Kyrub não usou o turnContext como prova de configuração: o draft persistido, a evidência condicional, a capability e o produto canônico precisam continuar coerentes no servidor.',
    'Nenhuma autorização de publicação foi criada e nenhum anúncio foi criado ou alterado no Mercado Livre.',
  ].join(' ');
};

export const handleKyrubiaMercadoLivreListingValidationCommand = async (input: {
  userId: string;
  message: string;
  context?: KyrubiaTurnContext;
}): Promise<KyrubiaMercadoLivreListingValidationCommandResult> => {
  if (!input.context || !isExplicitDraftValidationCommand(input.message)) {
    return { handled: false };
  }
  const proposalId = proposalIdFromPreparationContext(input.context);
  if (!proposalId) return { handled: false };

  const turnContext = refreshedPreparationContext(input.context);
  try {
    const validation = await validateKyrubiaMercadoLivreDraftListing({
      storeId: input.userId,
      proposalId,
      validatedByUserId: input.userId,
    });

    if (validation.status === 'ready_for_owner_authorization') {
      return {
        handled: true,
        turnContext,
        reply: [
          `O Mercado Livre respondeu ${validation.providerStatus} ao /items/validate: o payload persistido foi aceito no gate de validação.`,
          'Registrei a evidência como ready_for_owner_authorization com autoridade provider_items_validate.',
          'Isso não é autorização de publicação: executionStatus continua not_authorized, nenhum token de publicação foi criado e nenhum item foi publicado.',
          'A próxima fronteira é uma autorização explícita e separada do proprietário para a publicação real.',
        ].join(' '),
      };
    }

    const visibleCauses = validation.causes.slice(0, 5).map(compactCause).filter(Boolean);
    const causeText = visibleCauses.length
      ? ` O Mercado Livre apontou: ${visibleCauses.join(' | ')}.`
      : ` O Mercado Livre respondeu ${validation.providerStatus}, mas não devolveu uma causa estruturada utilizável.`;
    return {
      handled: true,
      turnContext,
      reply: [
        `O /items/validate respondeu ${validation.providerStatus} e o draft ficou como needs_correction.`,
        causeText,
        'O Kyrub bloqueou qualquer avanço para autorização real; nenhuma autorização de publicação foi criada e nenhum item foi publicado.',
        'Essas causas agora podem ser tratadas em um fluxo de correção do draft antes de uma nova validação.',
      ].join(' '),
    };
  } catch (error) {
    return {
      handled: true,
      turnContext,
      reply: unavailableReply(error),
    };
  }
};
