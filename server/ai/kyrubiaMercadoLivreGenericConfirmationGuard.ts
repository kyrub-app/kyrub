type GenericConfirmationGuardResult = {
  blocked: true;
  reply: string;
  turnContext: Record<string, unknown>;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const clean = (value: unknown, maximum = 4_000): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const latestUserMessage = (body: Record<string, unknown>): string => {
  if (!Array.isArray(body.messages)) return '';
  for (let index = body.messages.length - 1; index >= 0; index -= 1) {
    const message = record(body.messages[index]);
    if (message.role !== 'user') continue;
    return clean(message.content);
  }
  return '';
};

const normalizeConfirmation = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[.!?…]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();

export const isGenericMercadoLivreExternalWriteConfirmation = (
  message: string
): boolean => /^(?:sim|ok|okay|pode|pode sim|pode fazer|pode atualizar|confirmo|autorizo|prossiga|continue|manda|vai)$/i.test(
  normalizeConfirmation(message)
);

export const resolveKyrubiaMercadoLivreGenericConfirmationGuard = (
  input: unknown
): GenericConfirmationGuardResult | null => {
  const body = record(input);
  const turnContext = record(body.turnContext);
  if (
    turnContext.version !== 1 ||
    turnContext.source !== 'kyrub_runtime' ||
    turnContext.sourceAction !== 'mercado_livre_publication_preparation'
  ) return null;

  const scope = record(turnContext.scope);
  if (scope.kind !== 'own_store' || !clean(scope.storeId, 180)) return null;

  const hasProductEntity = Array.isArray(turnContext.entities) &&
    turnContext.entities.some(entity => record(entity).entityType === 'product');
  if (!hasProductEntity) return null;

  if (Array.isArray(turnContext.offeredIntents) && turnContext.offeredIntents.length > 0) {
    return null;
  }
  if (Object.keys(record(turnContext.selectedIntent)).length > 0) return null;
  if (Object.keys(record(turnContext.mercadoLivreRequirementProgress)).length > 0) return null;

  const message = latestUserMessage(body);
  if (!isGenericMercadoLivreExternalWriteConfirmation(message)) return null;

  return {
    blocked: true,
    turnContext,
    reply: [
      `A resposta “${message}” não autoriza nenhuma escrita externa no Mercado Livre.`,
      'Confirmações genéricas como “sim”, “ok” ou “pode” nunca substituem uma autorização explícita vinculada à proposta, ao item e à alteração exata.',
      'Se você quer executar a atualização já preparada, use o comando explícito de autorização com o ID mlupd_..., o item MLB... e os preços de origem e destino mostrados na proposta anterior.',
      'Nenhuma autorização foi criada e nenhum POST ou PUT /items foi enviado ao Mercado Livre.',
    ].join(' '),
  };
};
