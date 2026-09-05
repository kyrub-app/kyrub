import type { MercadoLivreRequirementCategoryOptions } from '../integrations/mercadoLivreRequirementOptionsService.js';

const clean = (value: unknown, maximum = 255): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

export type KyrubiaMercadoLivreAttributeSelection = {
  id: string;
  valueId?: string;
  valueName?: string;
};

export type KyrubiaMercadoLivreRequiredAttributePlan = {
  proposalId: string;
  categoryId: string;
  condition: string;
  listingTypeId: string;
  requiredAttributeIds: string[];
  resolvedAttributeIds: string[];
  unresolvedAttributeIds: string[];
  nextAttribute: {
    id: string;
    name: string;
    valueType: string;
    values: Array<{ id: string; name: string }>;
    inputMode: 'provider_values' | 'free_text';
  } | null;
  complete: boolean;
  authority: 'provider_api_requirement_options';
};

const normalizeSelections = (
  value: readonly KyrubiaMercadoLivreAttributeSelection[]
): Map<string, KyrubiaMercadoLivreAttributeSelection> => {
  const selections = new Map<string, KyrubiaMercadoLivreAttributeSelection>();
  for (const candidate of value.slice(0, 100)) {
    const id = clean(candidate.id, 160);
    const valueId = clean(candidate.valueId, 160);
    const valueName = clean(candidate.valueName, 255);
    if (!id || (!valueId && !valueName) || selections.has(id)) continue;
    selections.set(id, {
      id,
      ...(valueId ? { valueId } : {}),
      ...(valueName ? { valueName } : {}),
    });
  }
  return selections;
};

export const planKyrubiaMercadoLivreRequiredAttributes = (input: {
  proposalId: string;
  categoryId: string;
  condition: string;
  listingTypeId: string;
  options: MercadoLivreRequirementCategoryOptions;
  selections?: readonly KyrubiaMercadoLivreAttributeSelection[];
}): KyrubiaMercadoLivreRequiredAttributePlan => {
  const proposalId = clean(input.proposalId, 180);
  const categoryId = clean(input.categoryId, 160);
  const condition = clean(input.condition, 120);
  const listingTypeId = clean(input.listingTypeId, 120);
  if (!proposalId || !categoryId || !condition || !listingTypeId) {
    throw new Error('MERCADO_LIVRE_ATTRIBUTE_PLAN_TARGET_INVALID');
  }
  if (input.options.proposalId !== proposalId || input.options.category.id !== categoryId) {
    throw new Error('MERCADO_LIVRE_ATTRIBUTE_PLAN_OPTIONS_MISMATCH');
  }
  if (!input.options.conditions.includes(condition)) {
    throw new Error('MERCADO_LIVRE_ATTRIBUTE_PLAN_CONDITION_NOT_AVAILABLE');
  }
  const listingType = input.options.listingTypes.find(candidate => candidate.id === listingTypeId);
  if (!listingType) {
    throw new Error('MERCADO_LIVRE_ATTRIBUTE_PLAN_LISTING_TYPE_NOT_AVAILABLE');
  }

  const required = input.options.attributes.filter(attribute =>
    attribute.required ||
    (condition === 'new' && attribute.newRequired)
  );
  const requiredIds = required.map(attribute => attribute.id);
  const requiredSet = new Set(requiredIds);
  const selections = normalizeSelections(input.selections ?? []);

  for (const selectedId of selections.keys()) {
    if (!requiredSet.has(selectedId)) {
      throw new Error('MERCADO_LIVRE_ATTRIBUTE_PLAN_SELECTION_NOT_REQUIRED');
    }
  }

  for (const attribute of required) {
    const selection = selections.get(attribute.id);
    if (!selection) continue;
    if (attribute.values.length > 0) {
      const providerValue = attribute.values.find(candidate =>
        (selection.valueId && candidate.id === selection.valueId) ||
        (!selection.valueId && selection.valueName && candidate.name === selection.valueName)
      );
      if (!providerValue) {
        throw new Error('MERCADO_LIVRE_ATTRIBUTE_PLAN_VALUE_NOT_AVAILABLE');
      }
    }
  }

  const resolvedAttributeIds = requiredIds.filter(id => selections.has(id));
  const unresolved = required.filter(attribute => !selections.has(attribute.id));
  const next = unresolved[0] ?? null;

  return {
    proposalId,
    categoryId,
    condition,
    listingTypeId: listingType.id,
    requiredAttributeIds: requiredIds,
    resolvedAttributeIds,
    unresolvedAttributeIds: unresolved.map(attribute => attribute.id),
    nextAttribute: next
      ? {
          id: next.id,
          name: next.name,
          valueType: next.valueType,
          values: next.values.slice(0, 100),
          inputMode: next.values.length > 0 ? 'provider_values' : 'free_text',
        }
      : null,
    complete: unresolved.length === 0,
    authority: 'provider_api_requirement_options',
  };
};
