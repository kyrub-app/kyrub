import { randomUUID } from 'node:crypto';
import type { KyrubiaTurnContext } from '../../shared/kyrubiaContext.js';
import { executeKyrubiaMercadoLivrePublication } from '../integrations/mercadoLivreKyrubiaPublicationExecutionService.js';

export type KyrubiaMercadoLivrePublicationExecutionCommandResult =
  | { handled: false }
  | { handled: true; reply: string; turnContext: KyrubiaTurnContext };

const isExplicitPublicationExecutionCommand = (message: string): boolean =>
  /^(?:publicar|publique)\s+agora$/i.test(message.trim());

const clearPublicationCapability = (context: KyrubiaTurnContext): KyrubiaTurnContext => ({
  ...context,
  id: randomUUID(),
  generatedAt: new Date().toISOString(),
  offeredIntents: undefined,
  mercadoLivrePublicationAuthorization: undefined,
});

const errorCode = (error: unknown): string =>
  error instanceof Error ? error.message.split(':')[0] : 'MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_FAILED';

export const handleKyrubiaMercadoLivrePublicationExecutionCommand = async (input: {
  userId: string;
  message: string;
  context?: KyrubiaTurnContext;
}): Promise<KyrubiaMercadoLivrePublicationExecutionCommandResult> => {
  if (!input.context || !isExplicitPublicationExecutionCommand(input.message)) {
    return { handled: false };
  }
  const context = input.context;
  const authorization = context.mercadoLivrePublicationAuthorization;
  const proposalId = context.selectedIntent?.intent === 'mercado_livre.listing_type_select'
    ? context.selectedIntent.payload.proposalId.trim()
    : '';
  if (
    context.sourceAction !== 'mercado_livre_publication_preparation' ||
    !proposalId ||
    !authorization ||
    authorization.proposalId !== proposalId ||
    authorization.authority !== 'store_owner_publication_authorization' ||
    authorization.authorizationSource !== 'kyrubia_explicit_owner_command' ||
    authorization.transport !== 'server_issued_one_time_capability'
  ) {
    return {
      handled: true,
      turnContext: clearPublicationCapability(context),
      reply: 'O comando “Publicar agora” foi reconhecido, mas não há uma autorização one-time válida e vinculada a este mesmo rascunho. Nenhum POST /items foi executado.',
    };
  }
  if (authorization.expiresAtMillis <= Date.now()) {
    return {
      handled: true,
      turnContext: clearPublicationCapability(context),
      reply: 'A autorização one-time expirou antes da execução. Nenhum POST /items foi executado. Valide novamente o estado atual e gere uma nova autorização explícita antes de tentar publicar.',
    };
  }

  try {
    const result = await executeKyrubiaMercadoLivrePublication({
      storeId: input.userId,
      proposalId,
      authorizationId: authorization.authorizationId,
      authorizationToken: authorization.authorizationToken,
      executedByUserId: input.userId,
    });
    const identity = result.externalUserProductId
      ? ` O User Product correspondente é ${result.externalUserProductId}.`
      : '';
    const link = result.permalink ? ` Link retornado pelo provedor: ${result.permalink}.` : '';
    return {
      handled: true,
      turnContext: clearPublicationCapability(context),
      reply: [
        `Publicação concluída no Mercado Livre. O item criado é ${result.externalItemId}.`,
        `A autorização ${result.authorizationId} foi consumida uma única vez e a execução ${result.executionId} terminou como published.`,
        `O binding canônico ${result.bindingId} foi persistido para ligar o produto do Kyrub ao item externo.${identity}${link}`,
        'O token one-time foi removido do contexto desta conversa e não pode ser reutilizado para uma segunda publicação.',
      ].join(' '),
    };
  } catch (error) {
    const code = errorCode(error);
    const reconciliation = code === 'MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_RECONCILIATION_REQUIRED';
    const rejected = code === 'MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_PROVIDER_REJECTED';
    const publishedButUnreturned = code === 'MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_RESULT_ALREADY_PUBLISHED';
    const turnContext = clearPublicationCapability(context);
    if (reconciliation || publishedButUnreturned) {
      return {
        handled: true,
        turnContext,
        reply: 'A execução chegou a ser reservada e o resultado final não pôde ser confirmado com segurança no Kyrub. O fluxo foi estacionado em reconciliation_required e o token foi removido do contexto. Não tente publicar novamente: a próxima ação correta é reconciliar a execução existente com o Mercado Livre.',
      };
    }
    if (rejected) {
      return {
        handled: true,
        turnContext,
        reply: 'O Mercado Livre rejeitou definitivamente a tentativa de publicação. A autorização foi consumida/rejeitada e não será reutilizada. Nenhum retry automático será feito; o draft precisa ser corrigido e passar novamente pelos gates antes de nova publicação.',
      };
    }
    return {
      handled: true,
      turnContext,
      reply: `O comando “Publicar agora” foi bloqueado antes de uma execução confirmada (${code}). O Kyrub removeu a capability deste contexto para impedir reutilização acidental. Nenhum retry automático foi feito.`,
    };
  }
};
