import { randomUUID } from 'node:crypto';
import type { KyrubiaTurnContext } from '../../shared/kyrubiaContext.js';
import { executeKyrubiaMercadoLivrePublication } from '../integrations/mercadoLivreKyrubiaPublicationExecutionService.js';

export type KyrubiaMercadoLivrePublicationExecutionCommandResult =
  | { handled: false }
  | { handled: true; reply: string; turnContext: KyrubiaTurnContext };

const isExplicitPublicationExecutionCommand = (message: string): boolean =>
  /^(?:publicar|publique)\s+agora$/i.test(message.trim());

const refreshedPublicationContext = (context: KyrubiaTurnContext): KyrubiaTurnContext => ({
  ...context,
  id: randomUUID(),
  generatedAt: new Date().toISOString(),
  offeredIntents: undefined,
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
  const proposalId = context.selectedIntent?.intent === 'mercado_livre.listing_type_select'
    ? context.selectedIntent.payload.proposalId.trim()
    : '';
  const turnContext = refreshedPublicationContext(context);
  if (
    context.sourceAction !== 'mercado_livre_publication_preparation' ||
    !proposalId
  ) {
    return {
      handled: true,
      turnContext,
      reply: 'O comando “Publicar agora” foi reconhecido, mas não há um proposal de publicação válido neste contexto. Nenhum POST /items foi executado.',
    };
  }

  try {
    const result = await executeKyrubiaMercadoLivrePublication({
      storeId: input.userId,
      proposalId,
      executedByUserId: input.userId,
    });
    const identity = result.externalUserProductId
      ? ` O User Product correspondente é ${result.externalUserProductId}.`
      : '';
    const link = result.permalink ? ` Link retornado pelo provedor: ${result.permalink}.` : '';
    return {
      handled: true,
      turnContext,
      reply: [
        `Publicação concluída no Mercado Livre. O item criado é ${result.externalItemId}.`,
        `A autorização ${result.authorizationId} foi consumida uma única vez e a execução ${result.executionId} terminou como published.`,
        `O binding canônico ${result.bindingId} foi persistido para ligar o produto do Kyrub ao item externo.${identity}${link}`,
        'Nenhum bearer token precisou atravessar o navegador; a autorização foi resolvida e consumida exclusivamente no servidor.',
      ].join(' '),
    };
  } catch (error) {
    const code = errorCode(error);
    const reconciliation = code === 'MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_RECONCILIATION_REQUIRED';
    const rejected = code === 'MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_PROVIDER_REJECTED';
    const publishedButUnreturned = code === 'MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_RESULT_ALREADY_PUBLISHED';
    const expired = code === 'MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_AUTHORIZATION_EXPIRED_REVALIDATION_REQUIRED';
    if (expired) {
      return {
        handled: true,
        turnContext,
        reply: 'A autorização de 15 minutos expirou antes da execução. O Kyrub revogou essa autorização e invalidou a prontidão anterior para impedir publicação com evidência envelhecida. Nenhum POST /items foi executado. Diga novamente “Validar draft” e, se passar, “Autorizar publicação” antes de tentar “Publicar agora”.',
      };
    }
    if (reconciliation || publishedButUnreturned) {
      return {
        handled: true,
        turnContext,
        reply: 'A execução chegou a ser reservada e o resultado final não pôde ser confirmado com segurança no Kyrub. O fluxo foi estacionado em reconciliation_required. Não tente publicar novamente: a próxima ação correta é reconciliar a execução existente com o Mercado Livre.',
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
      reply: `O comando “Publicar agora” foi bloqueado antes de uma execução confirmada (${code}). Nenhum retry automático foi feito e nenhuma capability fornecida pelo cliente foi usada como autoridade.`,
    };
  }
};
