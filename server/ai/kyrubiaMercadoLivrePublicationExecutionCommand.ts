import { randomUUID } from 'node:crypto';
import type { KyrubiaTurnContext } from '../../shared/kyrubiaContext.js';
import { executeKyrubiaMercadoLivrePublication } from '../integrations/mercadoLivreKyrubiaPublicationExecutionService.js';
import { verifyAndReconcileKyrubiaMercadoLivrePublication } from '../integrations/mercadoLivreKyrubiaPostPublicationVerificationService.js';

export type KyrubiaMercadoLivrePublicationExecutionCommandResult =
  | { handled: false }
  | { handled: true; reply: string; turnContext: KyrubiaTurnContext };

const normalizeExplicitCommand = (message: string): string =>
  message.trim().replace(/[.!?…]+$/u, '').trim();

const isExplicitPublicationExecutionCommand = (message: string): boolean =>
  /^(?:publicar|publique)\s+agora$/i.test(normalizeExplicitCommand(message));

const isExplicitPostPublicationReconciliationCommand = (message: string): boolean =>
  /^(?:reconciliar|reconcile)(?:\s+a)?\s+publica(?:ção|cao)$/i.test(normalizeExplicitCommand(message));

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
  const publishNow = isExplicitPublicationExecutionCommand(input.message);
  const reconcilePublication = isExplicitPostPublicationReconciliationCommand(input.message);
  if (!input.context || (!publishNow && !reconcilePublication)) {
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
      reply: reconcilePublication
        ? 'O comando “Reconciliar publicação” foi reconhecido, mas não há um proposal de publicação válido neste contexto. Nenhuma leitura pós-publicação foi tratada como evidência e nenhuma alteração foi enviada ao Mercado Livre.'
        : 'O comando “Publicar agora” foi reconhecido, mas não há um proposal de publicação válido neste contexto. Nenhum POST /items foi executado.',
    };
  }

  if (reconcilePublication) {
    try {
      const result = await verifyAndReconcileKyrubiaMercadoLivrePublication({
        storeId: input.userId,
        proposalId,
        verifiedByUserId: input.userId,
      });
      if (result.status === 'mismatch') {
        const visible = result.mismatches.slice(0, 6).join(' | ');
        return {
          handled: true,
          turnContext,
          reply: [
            `A leitura pós-publicação do item ${result.externalItemId} encontrou divergência entre o payload autorizado e o estado relido no Mercado Livre.`,
            visible ? `Diferenças: ${visible}.` : 'O provedor não devolveu uma comparação coerente para todos os campos esperados.',
            `Os atributos conferidos ficaram em ${result.matchedAttributeCount}/${result.expectedAttributeCount}.`,
            'O Kyrub não marcou essa publicação como reconciliada e não enviou nenhuma escrita corretiva automática ao Mercado Livre.',
          ].join(' '),
        };
      }

      const price = result.providerPrice === null
        ? 'preço não informado'
        : `${result.providerCurrencyId || 'moeda não informada'} ${result.providerPrice}`;
      const userProduct = result.externalUserProductId
        ? ` O User Product ${result.externalUserProductId} também foi relido e a identidade coincidiu com o binding.`
        : '';
      const idempotency = result.alreadyReconciled
        ? ' A reconciliação canônica já existia e foi reconhecida de forma idempotente.'
        : '';
      return {
        handled: true,
        turnContext,
        reply: [
          `Readback pós-publicação concluído para ${result.externalItemId}.`,
          `O Mercado Livre devolveu status “${result.providerStatus || 'não informado'}”, título “${result.providerTitle || 'não informado'}”, ${price} e categoria ${result.providerCategoryId || 'não informada'}.`,
          `Os campos comerciais autorizados e ${result.matchedAttributeCount}/${result.expectedAttributeCount} atributo(s) esperado(s) coincidiram com a leitura atual.${userProduct}`,
          `A reconciliação canônica ficou ${result.reconciliationStatus ?? 'não concluída'} no binding ${result.bindingId}.${idempotency}`,
          'Essa etapa fez apenas leitura do provedor e persistência de evidência no Kyrub; nenhuma alteração foi enviada ao anúncio.',
        ].join(' '),
      };
    } catch (error) {
      const code = errorCode(error);
      return {
        handled: true,
        turnContext,
        reply: `O comando “Reconciliar publicação” foi reconhecido, mas o readback autoritativo foi bloqueado (${code}). O Kyrub não considerou a publicação reconciliada e não enviou nenhuma escrita corretiva ao Mercado Livre.`,
      };
    }
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
