import { createHash } from 'node:crypto';
import type {
  KyrubiaMercadoLivreAttributeValueOfferedIntent,
  KyrubiaMercadoLivreCollectedAttribute,
  KyrubiaMercadoLivreListingTypeOfferedIntent,
  KyrubiaMercadoLivreRequirementProgress,
} from '../../shared/kyrubiaContext.js';
import {
  inspectMercadoLivreRequirementCategoryOptions,
  type MercadoLivreRequirementCategoryOptions,
} from '../integrations/mercadoLivreRequirementOptionsService.js';

export type KyrubiaMercadoLivreAttributeCollectorStep = {
  reply: string;
  progress: KyrubiaMercadoLivreRequirementProgress;
  offeredIntents: KyrubiaMercadoLivreAttributeValueOfferedIntent[];
  complete: boolean;
};

const clean = (value: unknown, maximum = 255): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const requiredAttributes = (
  options: MercadoLivreRequirementCategoryOptions,
  condition: string
): MercadoLivreRequirementCategoryOptions['attributes'] =>
  options.attributes.filter(attribute =>
    attribute.required || (condition === 'new' && attribute.newRequired)
  );

const assertTupleCurrent = (
  progress: KyrubiaMercadoLivreRequirementProgress,
  options: MercadoLivreRequirementCategoryOptions
): void => {
  if (
    options.proposalId !== progress.proposalId ||
    options.category.id !== progress.categoryId ||
    options.category.name !== progress.categoryName
  ) {
    throw new Error('MERCADO_LIVRE_ATTRIBUTE_PROGRESS_CATEGORY_MISMATCH');
  }
  if (!options.conditions.includes(progress.condition)) {
    throw new Error('MERCADO_LIVRE_ATTRIBUTE_PROGRESS_CONDITION_STALE');
  }
  const listingType = options.listingTypes.find(candidate => candidate.id === progress.listingTypeId);
  if (!listingType) {
    throw new Error('MERCADO_LIVRE_ATTRIBUTE_PROGRESS_LISTING_TYPE_STALE');
  }
  if (listingType.name !== progress.listingTypeName) {
    throw new Error('MERCADO_LIVRE_ATTRIBUTE_PROGRESS_LISTING_TYPE_MISMATCH');
  }
};

const canonicalCollected = (
  progress: KyrubiaMercadoLivreRequirementProgress,
  options: MercadoLivreRequirementCategoryOptions
): KyrubiaMercadoLivreCollectedAttribute[] => {
  const required = requiredAttributes(options, progress.condition);
  const requiredById = new Map(required.map(attribute => [attribute.id, attribute] as const));
  const seen = new Set<string>();
  const result: KyrubiaMercadoLivreCollectedAttribute[] = [];
  for (const collected of progress.collectedAttributes.slice(0, 40)) {
    const id = clean(collected.id, 160);
    if (!id || seen.has(id)) {
      throw new Error('MERCADO_LIVRE_ATTRIBUTE_PROGRESS_INVALID');
    }
    seen.add(id);
    const providerAttribute = requiredById.get(id);
    if (!providerAttribute || providerAttribute.name !== clean(collected.name, 255)) {
      throw new Error('MERCADO_LIVRE_ATTRIBUTE_PROGRESS_STALE');
    }
    const valueName = clean(collected.valueName, 255);
    const valueId = clean(collected.valueId, 160);
    if (providerAttribute.values.length > 0) {
      const providerValue = valueId
        ? providerAttribute.values.find(value => value.id === valueId)
        : providerAttribute.values.find(value => normalize(value.name) === normalize(valueName));
      if (!providerValue || (valueName && providerValue.name !== valueName)) {
        throw new Error('MERCADO_LIVRE_ATTRIBUTE_VALUE_STALE');
      }
      result.push({
        id,
        name: providerAttribute.name,
        ...(providerValue.id ? { valueId: providerValue.id } : {}),
        valueName: providerValue.name,
      });
      continue;
    }
    if (!valueName) {
      throw new Error('MERCADO_LIVRE_ATTRIBUTE_VALUE_INVALID');
    }
    result.push({ id, name: providerAttribute.name, valueName });
  }
  if (progress.collectedAttributes.length > 40) {
    throw new Error('MERCADO_LIVRE_ATTRIBUTE_PROGRESS_LIMIT_EXCEEDED');
  }
  return result;
};

const valueIntentsFor = (
  progress: KyrubiaMercadoLivreRequirementProgress,
  attribute: MercadoLivreRequirementCategoryOptions['attributes'][number]
): KyrubiaMercadoLivreAttributeValueOfferedIntent[] =>
  attribute.values
    .filter(value => value.id && value.name)
    .slice(0, 3)
    .map((value, index) => ({
      id: `ml-attribute-value-${createHash('sha256')
        .update(`${progress.proposalId}:${progress.categoryId}:${progress.condition}:${progress.listingTypeId}:${attribute.id}:${value.id}`)
        .digest('hex')
        .slice(0, 28)}`,
      intent: 'mercado_livre.attribute_value_select',
      label: value.name,
      payload: {
        proposalId: progress.proposalId,
        categoryId: progress.categoryId,
        categoryName: progress.categoryName,
        condition: progress.condition,
        listingTypeId: progress.listingTypeId,
        listingTypeName: progress.listingTypeName,
        attributeId: attribute.id,
        attributeName: attribute.name,
        valueId: value.id,
        valueName: value.name,
        providerAuthority: 'provider_api_requirement_options',
      },
      authorization: 'intent_only',
      primary: index === 0,
    }));

const attributePrompt = (
  progress: KyrubiaMercadoLivreRequirementProgress,
  attribute: MercadoLivreRequirementCategoryOptions['attributes'][number]
): string => {
  const answered = progress.collectedAttributes.length;
  if (attribute.values.length > 0) {
    const preview = attribute.values
      .slice(0, 8)
      .map(value => value.name)
      .join(', ');
    const remaining = attribute.values.length - Math.min(attribute.values.length, 8);
    return [
      `Agora preciso de “${attribute.name}” (${attribute.id}), o próximo atributo obrigatório do anúncio.`,
      `Valores oficiais disponíveis: ${preview}${remaining > 0 ? ` e mais ${remaining}` : ''}.`,
      'Escolha uma opção abaixo ou digite exatamente um dos valores oficiais.',
      `Já coletei ${answered} atributo(s) obrigatório(s) nesta conversa.`,
      'Nada foi gravado no rascunho e nenhuma autorização de publicação foi criada.',
    ].join(' ');
  }
  return [
    `Agora preciso de “${attribute.name}” (${attribute.id}), o próximo atributo obrigatório do anúncio.`,
    `O Mercado Livre informa o tipo de valor como “${attribute.valueType || 'texto'}” e não forneceu uma lista fechada de opções.`,
    'Digite o valor que deseja usar.',
    `Já coletei ${answered} atributo(s) obrigatório(s) nesta conversa.`,
    'Essa resposta continuará apenas no contexto da conversa; nada será gravado no rascunho ainda.',
  ].join(' ');
};

const completedReply = (
  progress: KyrubiaMercadoLivreRequirementProgress,
  options: MercadoLivreRequirementCategoryOptions
): string => {
  const conditional = options.attributes.filter(attribute => attribute.conditionalRequired);
  return [
    `Coletei nesta conversa os ${progress.collectedAttributes.length} atributo(s) obrigatórios básicos atualmente exigidos pelo Mercado Livre para “${options.category.name}”, condição “${progress.condition}” e tipo de anúncio “${progress.listingTypeName}”.`,
    conditional.length > 0
      ? `Ainda existem ${conditional.length} atributo(s) marcados pelo provedor como condicionais; eles precisam ser avaliados antes de qualquer configuração do draft.`
      : 'O provedor não marcou atributos condicionais nesta leitura.',
    'Os valores coletados continuam sendo somente contexto de intenção do proprietário.',
    'Nenhum requisito foi persistido, nenhuma autorização de publicação foi criada e nada foi publicado no Mercado Livre.',
  ].join(' ');
};

const buildStep = (
  progress: KyrubiaMercadoLivreRequirementProgress,
  options: MercadoLivreRequirementCategoryOptions
): KyrubiaMercadoLivreAttributeCollectorStep => {
  assertTupleCurrent(progress, options);
  const collected = canonicalCollected(progress, options);
  const required = requiredAttributes(options, progress.condition);
  const supplied = new Set(collected.map(attribute => attribute.id));
  const pending = required.find(attribute => !supplied.has(attribute.id));
  const nextProgress: KyrubiaMercadoLivreRequirementProgress = {
    ...progress,
    collectedAttributes: collected,
    ...(pending
      ? { pendingAttribute: { id: pending.id, name: pending.name, valueType: pending.valueType } }
      : { pendingAttribute: undefined }),
    providerAuthority: 'provider_api_requirement_options',
    authorization: 'intent_only',
  };
  if (!pending) {
    return {
      reply: completedReply(nextProgress, options),
      progress: nextProgress,
      offeredIntents: [],
      complete: true,
    };
  }
  return {
    reply: attributePrompt(nextProgress, pending),
    progress: nextProgress,
    offeredIntents: valueIntentsFor(nextProgress, pending),
    complete: false,
  };
};

export const startMercadoLivreRequiredAttributeCollection = (input: {
  listingIntent: KyrubiaMercadoLivreListingTypeOfferedIntent;
  options: MercadoLivreRequirementCategoryOptions;
}): KyrubiaMercadoLivreAttributeCollectorStep => {
  const progress: KyrubiaMercadoLivreRequirementProgress = {
    proposalId: input.listingIntent.payload.proposalId,
    categoryId: input.listingIntent.payload.categoryId,
    categoryName: input.listingIntent.payload.categoryName,
    condition: input.listingIntent.payload.condition,
    listingTypeId: input.listingIntent.payload.listingTypeId,
    listingTypeName: input.listingIntent.payload.listingTypeName,
    collectedAttributes: [],
    providerAuthority: 'provider_api_requirement_options',
    authorization: 'intent_only',
  };
  return buildStep(progress, input.options);
};

const assertPendingMatches = (
  progress: KyrubiaMercadoLivreRequirementProgress,
  attribute: MercadoLivreRequirementCategoryOptions['attributes'][number]
): void => {
  if (
    !progress.pendingAttribute ||
    progress.pendingAttribute.id !== attribute.id ||
    progress.pendingAttribute.name !== attribute.name ||
    progress.pendingAttribute.valueType !== attribute.valueType
  ) {
    throw new Error('MERCADO_LIVRE_ATTRIBUTE_PROGRESS_PENDING_STALE');
  }
};

const answerFromIntent = (
  progress: KyrubiaMercadoLivreRequirementProgress,
  attribute: MercadoLivreRequirementCategoryOptions['attributes'][number],
  intent: KyrubiaMercadoLivreAttributeValueOfferedIntent
): KyrubiaMercadoLivreCollectedAttribute => {
  const payload = intent.payload;
  if (
    payload.proposalId !== progress.proposalId ||
    payload.categoryId !== progress.categoryId ||
    payload.categoryName !== progress.categoryName ||
    payload.condition !== progress.condition ||
    payload.listingTypeId !== progress.listingTypeId ||
    payload.listingTypeName !== progress.listingTypeName ||
    payload.attributeId !== attribute.id ||
    payload.attributeName !== attribute.name ||
    payload.providerAuthority !== 'provider_api_requirement_options'
  ) {
    throw new Error('MERCADO_LIVRE_ATTRIBUTE_VALUE_INTENT_MISMATCH');
  }
  const providerValue = attribute.values.find(value =>
    value.id === payload.valueId && value.name === payload.valueName
  );
  if (!providerValue) {
    throw new Error('MERCADO_LIVRE_ATTRIBUTE_VALUE_STALE');
  }
  return {
    id: attribute.id,
    name: attribute.name,
    valueId: providerValue.id,
    valueName: providerValue.name,
  };
};

const answerFromMessage = (
  attribute: MercadoLivreRequirementCategoryOptions['attributes'][number],
  message: string
): KyrubiaMercadoLivreCollectedAttribute | null => {
  const text = clean(message, 255);
  if (!text) return null;
  if (/^(cancelar|cancela|parar|pare|depois|voltar|pular|skip|não sei|nao sei)$/i.test(text)) {
    return null;
  }
  if (attribute.values.length > 0) {
    const wanted = normalize(text);
    const providerValue = attribute.values.find(value =>
      normalize(value.id) === wanted || normalize(value.name) === wanted
    );
    if (!providerValue) return null;
    return {
      id: attribute.id,
      name: attribute.name,
      ...(providerValue.id ? { valueId: providerValue.id } : {}),
      valueName: providerValue.name,
    };
  }
  return { id: attribute.id, name: attribute.name, valueName: text };
};

export const continueMercadoLivreRequiredAttributeCollection = async (input: {
  userId: string;
  progress: KyrubiaMercadoLivreRequirementProgress;
  selectedValueIntent?: KyrubiaMercadoLivreAttributeValueOfferedIntent;
  message: string;
}): Promise<KyrubiaMercadoLivreAttributeCollectorStep> => {
  const options = await inspectMercadoLivreRequirementCategoryOptions({
    storeId: input.userId,
    proposalId: input.progress.proposalId,
    categoryId: input.progress.categoryId,
    categoryName: input.progress.categoryName,
    requestedByUserId: input.userId,
  });
  assertTupleCurrent(input.progress, options);
  const collected = canonicalCollected(input.progress, options);
  const required = requiredAttributes(options, input.progress.condition);
  const supplied = new Set(collected.map(attribute => attribute.id));
  const pending = required.find(attribute => !supplied.has(attribute.id));
  if (!pending) {
    return buildStep({ ...input.progress, collectedAttributes: collected }, options);
  }
  assertPendingMatches(input.progress, pending);
  const answer = input.selectedValueIntent
    ? answerFromIntent(input.progress, pending, input.selectedValueIntent)
    : answerFromMessage(pending, input.message);
  if (!answer) {
    const current = buildStep({ ...input.progress, collectedAttributes: collected }, options);
    return {
      ...current,
      reply: `${current.reply} Não consegui reconhecer sua resposta como um valor válido para este atributo; o Kyrub não avançou nem gravou nada.`,
    };
  }
  return buildStep({
    ...input.progress,
    collectedAttributes: [...collected, answer],
  }, options);
};