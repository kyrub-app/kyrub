import { createHash } from 'node:crypto';
import type {
  KyrubiaMercadoLivreAttributeValueOfferedIntent,
  KyrubiaMercadoLivreCollectedAttribute,
  KyrubiaMercadoLivreListingTypeOfferedIntent,
  KyrubiaMercadoLivreRequirementProgress,
} from '../../shared/kyrubiaContext.js';
import {
  inspectMercadoLivreConditionalRequirements,
  type MercadoLivreConditionalInspectionAttribute,
  type MercadoLivreConditionalRequirementInspectionResult,
} from '../integrations/mercadoLivreConditionalRequirementInspectionService.js';
import {
  inspectMercadoLivreRequirementCategoryOptions,
  type MercadoLivreRequirementCategoryOptions,
} from '../integrations/mercadoLivreRequirementOptionsService.js';
import { planKyrubiaMercadoLivreRequiredAttributes } from './kyrubiaMercadoLivreRequiredAttributePlanner.js';

export type KyrubiaMercadoLivreAttributeCollectorStep = {
  reply: string;
  progress: KyrubiaMercadoLivreRequirementProgress;
  offeredIntents: KyrubiaMercadoLivreAttributeValueOfferedIntent[];
  complete: boolean;
};

type ProviderAttribute = MercadoLivreRequirementCategoryOptions['attributes'][number];
type RequirementKind = 'base' | 'conditional';

const MAX_COLLECTED_ATTRIBUTES = 40;

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

const planFor = (
  progress: KyrubiaMercadoLivreRequirementProgress,
  options: MercadoLivreRequirementCategoryOptions,
  collectedAttributes: readonly KyrubiaMercadoLivreCollectedAttribute[] = []
) => planKyrubiaMercadoLivreRequiredAttributes({
  proposalId: progress.proposalId,
  categoryId: progress.categoryId,
  condition: progress.condition,
  listingTypeId: progress.listingTypeId,
  options,
  selections: collectedAttributes.map(attribute => ({
    id: attribute.id,
    ...(attribute.valueId ? { valueId: attribute.valueId } : {}),
    ...(attribute.valueName ? { valueName: attribute.valueName } : {}),
  })),
});

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

const canonicalizeCollectedAttribute = (
  collected: KyrubiaMercadoLivreCollectedAttribute,
  providerAttribute: ProviderAttribute
): KyrubiaMercadoLivreCollectedAttribute => {
  if (providerAttribute.name !== clean(collected.name, 255)) {
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
    return {
      id: providerAttribute.id,
      name: providerAttribute.name,
      ...(providerValue.id ? { valueId: providerValue.id } : {}),
      valueName: providerValue.name,
    };
  }
  if (!valueName) {
    throw new Error('MERCADO_LIVRE_ATTRIBUTE_VALUE_INVALID');
  }
  return {
    id: providerAttribute.id,
    name: providerAttribute.name,
    valueName,
  };
};

const canonicalCollected = (
  progress: KyrubiaMercadoLivreRequirementProgress,
  options: MercadoLivreRequirementCategoryOptions
): KyrubiaMercadoLivreCollectedAttribute[] => {
  if (progress.collectedAttributes.length > MAX_COLLECTED_ATTRIBUTES) {
    throw new Error('MERCADO_LIVRE_ATTRIBUTE_PROGRESS_LIMIT_EXCEEDED');
  }
  const providerById = new Map(options.attributes.map(attribute => [attribute.id, attribute] as const));
  const seen = new Set<string>();
  const result: KyrubiaMercadoLivreCollectedAttribute[] = [];
  for (const collected of progress.collectedAttributes) {
    const id = clean(collected.id, 160);
    if (!id || seen.has(id)) {
      throw new Error('MERCADO_LIVRE_ATTRIBUTE_PROGRESS_INVALID');
    }
    seen.add(id);
    const providerAttribute = providerById.get(id);
    if (!providerAttribute) {
      throw new Error('MERCADO_LIVRE_ATTRIBUTE_PROGRESS_STALE');
    }
    result.push(canonicalizeCollectedAttribute(collected, providerAttribute));
  }
  return result;
};

const baseRequiredIds = (
  progress: KyrubiaMercadoLivreRequirementProgress,
  options: MercadoLivreRequirementCategoryOptions
): Set<string> => new Set(planFor(progress, options).requiredAttributeIds);

const inspectionAttributes = (
  collected: readonly KyrubiaMercadoLivreCollectedAttribute[]
): MercadoLivreConditionalInspectionAttribute[] =>
  collected.map(attribute => ({
    id: attribute.id,
    ...(attribute.valueId ? { valueId: attribute.valueId } : {}),
    valueName: attribute.valueName,
  }));

const inspectConditionalRequirements = async (input: {
  userId: string;
  progress: KyrubiaMercadoLivreRequirementProgress;
  collected: readonly KyrubiaMercadoLivreCollectedAttribute[];
}): Promise<MercadoLivreConditionalRequirementInspectionResult> =>
  inspectMercadoLivreConditionalRequirements({
    storeId: input.userId,
    proposalId: input.progress.proposalId,
    categoryId: input.progress.categoryId,
    categoryName: input.progress.categoryName,
    condition: input.progress.condition,
    listingTypeId: input.progress.listingTypeId,
    listingTypeName: input.progress.listingTypeName,
    attributes: inspectionAttributes(input.collected),
    requestedByUserId: input.userId,
  });

const recoverProviderAuthorizedConditionalState = async (input: {
  userId: string;
  progress: KyrubiaMercadoLivreRequirementProgress;
  baseCollected: KyrubiaMercadoLivreCollectedAttribute[];
  conditionalCandidates: KyrubiaMercadoLivreCollectedAttribute[];
}): Promise<{
  collected: KyrubiaMercadoLivreCollectedAttribute[];
  inspection: MercadoLivreConditionalRequirementInspectionResult;
}> => {
  const remaining = new Map(
    input.conditionalCandidates.map(attribute => [attribute.id, attribute] as const)
  );
  const collected = [...input.baseCollected];
  let inspection = await inspectConditionalRequirements({
    userId: input.userId,
    progress: input.progress,
    collected,
  });

  for (let round = 0; round <= MAX_COLLECTED_ATTRIBUTES && remaining.size > 0; round += 1) {
    const currentlyRequired = new Set(inspection.missingConditionalAttributeIds);
    const recoverable = [...remaining.values()].filter(attribute =>
      currentlyRequired.has(attribute.id)
    );
    if (recoverable.length === 0) break;
    for (const attribute of recoverable) {
      collected.push(attribute);
      remaining.delete(attribute.id);
    }
    inspection = await inspectConditionalRequirements({
      userId: input.userId,
      progress: input.progress,
      collected,
    });
  }

  if (remaining.size > 0) {
    throw new Error(
      `MERCADO_LIVRE_ATTRIBUTE_PROGRESS_CONDITIONAL_STALE:${[...remaining.keys()].join(',')}`
    );
  }

  return { collected, inspection };
};

const valueIntentsFor = (
  progress: KyrubiaMercadoLivreRequirementProgress,
  attribute: ProviderAttribute
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
  attribute: ProviderAttribute,
  requirementKind: RequirementKind
): string => {
  const answered = progress.collectedAttributes.length;
  const requirementDescription = requirementKind === 'conditional'
    ? 'o próximo atributo condicional que a validação oficial do Mercado Livre passou a exigir para este anúncio'
    : 'o próximo atributo obrigatório básico do anúncio';
  const authorityNote = requirementKind === 'conditional'
    ? 'A necessidade deste atributo veio da inspeção oficial /attributes/conditional; os valores continuam sendo revalidados nas opções atuais do provedor.'
    : 'A necessidade deste atributo veio das opções atuais da categoria revalidadas no Mercado Livre.';

  if (attribute.values.length > 0) {
    const preview = attribute.values
      .slice(0, 8)
      .map(value => value.name)
      .join(', ');
    const remaining = attribute.values.length - Math.min(attribute.values.length, 8);
    return [
      `Agora preciso de “${attribute.name}” (${attribute.id}), ${requirementDescription}.`,
      authorityNote,
      `Valores oficiais disponíveis: ${preview}${remaining > 0 ? ` e mais ${remaining}` : ''}.`,
      'Escolha uma opção abaixo ou digite exatamente um dos valores oficiais.',
      `Já coletei ${answered} atributo(s) nesta conversa.`,
      'Nada foi gravado no rascunho e nenhuma autorização de publicação foi criada.',
    ].join(' ');
  }

  return [
    `Agora preciso de “${attribute.name}” (${attribute.id}), ${requirementDescription}.`,
    authorityNote,
    `O Mercado Livre informa o tipo de valor como “${attribute.valueType || 'texto'}” e não forneceu uma lista fechada de opções.`,
    'Digite o valor que deseja usar.',
    `Já coletei ${answered} atributo(s) nesta conversa.`,
    'Essa resposta continuará apenas no contexto da conversa; nada será gravado no rascunho ainda.',
  ].join(' ');
};

const completedReply = (
  progress: KyrubiaMercadoLivreRequirementProgress,
  options: MercadoLivreRequirementCategoryOptions,
  inspection: MercadoLivreConditionalRequirementInspectionResult,
  baseCount: number
): string => {
  const conditionalCount = Math.max(0, progress.collectedAttributes.length - baseCount);
  const providerConditionalFlags = options.attributes.filter(attribute => attribute.conditionalRequired).length;
  return [
    `Coletei nesta conversa os ${baseCount} atributo(s) obrigatório(s) básico(s) e ${conditionalCount} atributo(s) condicional(is) confirmados pelo Mercado Livre para “${options.category.name}”, condição “${progress.condition}” e tipo de anúncio “${progress.listingTypeName}”.`,
    `A inspeção oficial /attributes/conditional não deixou nenhum requisito condicional pendente nesta tupla revalidada; ela reportou ${inspection.requiredConditionalAttributes.length} requisito(s) condicional(is) no estado final.`,
    `A leitura geral da categoria ainda possui ${providerConditionalFlags} atributo(s) marcados com flag condicional, mas apenas a inspeção oficial do anúncio foi usada para decidir o que realmente precisava ser perguntado.`,
    'Os valores coletados continuam sendo somente contexto de intenção do proprietário.',
    'Agora a conversa está pronta para discutir a primeira configuração interna do draft, mas nenhum RequirementConfiguration foi criado, nenhuma autorização de publicação foi criada e nada foi publicado no Mercado Livre.',
  ].join(' ');
};

const progressWithPending = (
  progress: KyrubiaMercadoLivreRequirementProgress,
  collectedAttributes: KyrubiaMercadoLivreCollectedAttribute[],
  pending?: ProviderAttribute
): KyrubiaMercadoLivreRequirementProgress => ({
  ...progress,
  collectedAttributes,
  ...(pending
    ? { pendingAttribute: { id: pending.id, name: pending.name, valueType: pending.valueType } }
    : { pendingAttribute: undefined }),
  providerAuthority: 'provider_api_requirement_options',
  authorization: 'intent_only',
});

const buildStep = async (input: {
  userId: string;
  progress: KyrubiaMercadoLivreRequirementProgress;
  options: MercadoLivreRequirementCategoryOptions;
}): Promise<KyrubiaMercadoLivreAttributeCollectorStep> => {
  assertTupleCurrent(input.progress, input.options);
  const collected = canonicalCollected(input.progress, input.options);
  const baseIds = baseRequiredIds(input.progress, input.options);
  const baseCollected = collected.filter(attribute => baseIds.has(attribute.id));
  const conditionalCandidates = collected.filter(attribute => !baseIds.has(attribute.id));
  const plan = planFor(input.progress, input.options, baseCollected);

  if (!plan.complete) {
    if (conditionalCandidates.length > 0) {
      throw new Error('MERCADO_LIVRE_ATTRIBUTE_PROGRESS_CONDITIONAL_BEFORE_BASE');
    }
    const pending = plan.nextAttribute
      ? input.options.attributes.find(attribute => attribute.id === plan.nextAttribute?.id)
      : undefined;
    if (plan.nextAttribute && !pending) {
      throw new Error('MERCADO_LIVRE_ATTRIBUTE_PLAN_PROVIDER_ATTRIBUTE_MISSING');
    }
    if (!pending) {
      throw new Error('MERCADO_LIVRE_ATTRIBUTE_PLAN_PENDING_ATTRIBUTE_MISSING');
    }
    const nextProgress = progressWithPending(input.progress, baseCollected, pending);
    return {
      reply: attributePrompt(nextProgress, pending, 'base'),
      progress: nextProgress,
      offeredIntents: valueIntentsFor(nextProgress, pending),
      complete: false,
    };
  }

  const conditionalState = await recoverProviderAuthorizedConditionalState({
    userId: input.userId,
    progress: input.progress,
    baseCollected,
    conditionalCandidates,
  });
  const pendingConditionalId = conditionalState.inspection.missingConditionalAttributeIds[0];
  const pendingConditional = pendingConditionalId
    ? input.options.attributes.find(attribute => attribute.id === pendingConditionalId)
    : undefined;
  if (pendingConditionalId && !pendingConditional) {
    throw new Error('MERCADO_LIVRE_CONDITIONAL_INSPECTION_PROVIDER_ATTRIBUTE_UNKNOWN');
  }

  const nextProgress = progressWithPending(
    input.progress,
    conditionalState.collected,
    pendingConditional
  );
  if (pendingConditional) {
    return {
      reply: attributePrompt(nextProgress, pendingConditional, 'conditional'),
      progress: nextProgress,
      offeredIntents: valueIntentsFor(nextProgress, pendingConditional),
      complete: false,
    };
  }

  return {
    reply: completedReply(
      nextProgress,
      input.options,
      conditionalState.inspection,
      baseCollected.length
    ),
    progress: nextProgress,
    offeredIntents: [],
    complete: true,
  };
};

export const startMercadoLivreRequiredAttributeCollection = async (input: {
  userId: string;
  listingIntent: KyrubiaMercadoLivreListingTypeOfferedIntent;
  options: MercadoLivreRequirementCategoryOptions;
}): Promise<KyrubiaMercadoLivreAttributeCollectorStep> => {
  const userId = clean(input.userId, 160);
  if (!userId) {
    throw new Error('MERCADO_LIVRE_ATTRIBUTE_COLLECTION_OWNER_REQUIRED');
  }
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
  return buildStep({ userId, progress, options: input.options });
};

const assertPendingMatches = (
  progress: KyrubiaMercadoLivreRequirementProgress,
  attribute: ProviderAttribute
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
  attribute: ProviderAttribute,
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
  attribute: ProviderAttribute,
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
  const userId = clean(input.userId, 160);
  if (!userId) {
    throw new Error('MERCADO_LIVRE_ATTRIBUTE_COLLECTION_OWNER_REQUIRED');
  }
  const options = await inspectMercadoLivreRequirementCategoryOptions({
    storeId: userId,
    proposalId: input.progress.proposalId,
    categoryId: input.progress.categoryId,
    categoryName: input.progress.categoryName,
    requestedByUserId: userId,
  });
  assertTupleCurrent(input.progress, options);

  const current = await buildStep({
    userId,
    progress: input.progress,
    options,
  });
  if (current.complete) return current;

  const pendingId = current.progress.pendingAttribute?.id;
  const pending = pendingId
    ? options.attributes.find(attribute => attribute.id === pendingId)
    : undefined;
  if (!pending) {
    throw new Error('MERCADO_LIVRE_ATTRIBUTE_PLAN_PENDING_ATTRIBUTE_MISSING');
  }
  assertPendingMatches(input.progress, pending);

  const answer = input.selectedValueIntent
    ? answerFromIntent(current.progress, pending, input.selectedValueIntent)
    : answerFromMessage(pending, input.message);
  if (!answer) {
    return {
      ...current,
      reply: `${current.reply} Não consegui reconhecer sua resposta como um valor válido para este atributo; o Kyrub não avançou nem gravou nada.`,
    };
  }

  return buildStep({
    userId,
    progress: {
      ...current.progress,
      collectedAttributes: [...current.progress.collectedAttributes, answer],
    },
    options,
  });
};