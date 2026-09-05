import { randomUUID } from 'node:crypto';
import type { KyrubiaTurnContext } from '../../shared/kyrubiaContext.js';
import { validateKyrubiaMercadoLivreDraftListing } from '../integrations/mercadoLivreKyrubiaListingValidationService.js';
import { authorizeKyrubiaMercadoLivrePublication } from '../integrations/mercadoLivreKyrubiaPublicationAuthorizationService.js';
import { handleKyrubiaMercadoLivrePublicationExecutionCommand } from './kyrubiaMercadoLivrePublicationExecutionCommand.js';

export type KyrubiaMercadoLivreListingValidationCommandResult =
  | { handled: false }
  | {
      handled: true;
      reply: string;
      turnContext: KyrubiaTurnContext;
    };

const isExplicitDraftValidationCommand = (message: string): boolean =>
  /^(?:validar|valide)(?:\s+o)?\s+(?:draft|rascunho)$/i.test(message.trim());

const isExplicitPublicationAuthorizationCommand = (message: string): boolean =>
  /^(?:autorizar|autorize)(?:\s+a)?\s+publica(?:ção|cao)$/i.test(message.trim());

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
  mercadoLivrePublicationAuthorization: undefined,
});

const compactCause = (
  cause: { code: string; message: string; reference: string }
): string => {
  const parts = [cause.code, cause.message, cause.reference].filter(Boolean);
  return parts.join(' — ');
};

const validationUnavailableReply = (error: unknown): string => {
  const code = error instanceof Error
    ? error.message.split(':')[0]
    : 'MERCADO_LIVRE_KYRUBIA_LISTING_VALIDATION_UNAVAILABLE';
  return [
    `O comando “Validar draft” foi reconhecido, mas o gate autoritativo bloqueou a validação (${code}).`,
    'O Kyrub não usou o turnContext como prova de configuração: o draft persistido, a evidência condicional, a capability e o produto canônico precisam continuar coerentes no servidor.',
    'Nenhuma autorização de publicação foi criada e nenhum anúncio foi criado ou alterado no Mercado Livre.',
  ].join(' ');
};

const authorizationUnavailableReply = (error: unknown): string => {
  const code = error instanceof Error
    ? error.message.split(':')[0]
    : 'MERCADO_LIVRE_KYRUBIA_PUBLICATION_AUTHORIZATION_UNAVAILABLE';
  return [
    `O comando “Autorizar publicação” foi reconhecido, mas o gate autoritativo bloqueou a autorização (${code}).`,
    'A autorização só nasce se a validação 204 da Cairubia, o payload, a capability e o produto canônico ainda forem exatamente os mesmos no servidor.',
    'Nenhuma autorização utilizável foi criada para este comando e nenhum anúncio foi publicado ou alterado no Mercado Livre.',
  ].join(' ');
};

export const handleKyrubiaMercadoLivreListingValidationCommand = async (input: {
  userId: string;
  message: string;
  context?: KyrubiaTurnContext;
}): Promise<KyrubiaMercadoLivreListingValidationCommandResult> => {
  if (!input.context) return { handled: false };

  const executionCommand = await handleKyrubiaMercadoLivrePublicationExecutionCommand(input);
  if (executionCommand.handled) return executionCommand;

  const proposalId = proposalIdFromPreparationContext(input.context);
  if (!proposalId) return { handled: false };

  if (isExplicitPublicationAuthorizationCommand(input.message)) {
    const turnContext = refreshedPreparationContext(input.context);
    try {
      const authorization = await authorizeKyrubiaMercadoLivrePublication({
        storeId: input.userId,
        proposalId,
        authorizedByUserId: input.userId,
      });
      return {
        handled: true,
        turnContext,
        reply: [
          'A autorização explícita do proprietário foi registrada.',
          `O proposal agora está executionStatus=authorized e a autorização ${authorization.authorizationId} ficou disponível por até 15 minutos.`,
          'O segredo interno dessa autorização não é enviado ao navegador; o Firestore guarda somente o hash e a Cairubia continuará apenas com o proposalId como localizador conversacional.',
          'Autorizar ainda não publica: nenhum POST /items foi executado e nenhum anúncio foi criado ou alterado no Mercado Livre.',
          'Se quiser atravessar a última fronteira e executar a publicação real, diga exatamente “Publicar agora”. Esse comando reabrirá a autorização no servidor e a consumirá uma única vez.',
        ].join(' '),
      };
    } catch (error) {
      return {
        handled: true,
        turnContext,
        reply: authorizationUnavailableReply(error),
      };
    }
  }

  if (!isExplicitDraftValidationCommand(input.message)) {
    return { handled: false };
  }

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
          'Isso não é autorização de publicação: executionStatus continua not_authorized, nenhuma autorização de execução foi criada e nenhum item foi publicado.',
          'Se você realmente quiser criar a autorização one-time para este payload já validado, diga exatamente “Autorizar publicação”. Esse comando ainda não publica o item.',
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
      reply: validationUnavailableReply(error),
    };
  }
};
