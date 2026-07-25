import type {
  Product,
  ProductOptionChoice,
  ProductOptionGroup,
  ProductSelectedOption,
} from '../types';

export interface ProductConfigurationSelection extends Product {
  lineKey: string;
  product: Product;
  unitPrice: number;
  selectedOptions: ProductSelectedOption[];
  customizationSummary: string;
}

const cleanString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const integerInRange = (
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number => {
  const parsed = finiteNumber(value);
  if (parsed === null || !Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

export const parseProductOptionChoices = (
  value: unknown
): ProductOptionChoice[] => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value.slice(0, 30).flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const record = candidate as Record<string, unknown>;
    const name = cleanString(record.name).slice(0, 60);
    const normalizedName = name.toLocaleLowerCase('pt-BR');
    const rawPriceDelta = finiteNumber(record.priceDelta) ?? 0;
    const priceDelta = Math.max(0, Number(rawPriceDelta.toFixed(2)));

    if (!name || seen.has(normalizedName)) return [];
    seen.add(normalizedName);

    return [{
      id: cleanString(record.id) || `choice-${index + 1}`,
      name,
      priceDelta,
    } satisfies ProductOptionChoice];
  });
};

export const parseProductOptionGroups = (
  value: unknown
): ProductOptionGroup[] => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value.slice(0, 10).flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const record = candidate as Record<string, unknown>;
    const name = cleanString(record.name).slice(0, 60);
    const normalizedName = name.toLocaleLowerCase('pt-BR');
    const choices = parseProductOptionChoices(record.choices);

    if (!name || choices.length === 0 || seen.has(normalizedName)) return [];
    seen.add(normalizedName);

    const maxSelections = integerInRange(
      record.maxSelections,
      1,
      1,
      choices.length
    );
    const minSelections = integerInRange(
      record.minSelections,
      0,
      0,
      maxSelections
    );

    return [{
      id: cleanString(record.id) || `group-${index + 1}`,
      name,
      minSelections,
      maxSelections,
      choices,
    } satisfies ProductOptionGroup];
  });
};

export const getCartLineKey = (
  productId: string,
  selectedOptions: ProductSelectedOption[]
): string => {
  const optionKey = [...selectedOptions]
    .sort((left, right) => {
      const groupComparison = left.groupId.localeCompare(right.groupId);
      return groupComparison || left.choiceId.localeCompare(right.choiceId);
    })
    .map(option => `${option.groupId}:${option.choiceId}`)
    .join('|');

  return optionKey ? `${productId}::${optionKey}` : productId;
};

export const buildProductConfigurationSelection = (
  product: Product,
  selectedChoiceIds: Record<string, string[]>
): ProductConfigurationSelection => {
  const optionGroups = parseProductOptionGroups(product.optionGroups);
  const selectedOptions: ProductSelectedOption[] = [];
  const summaryParts: string[] = [];

  for (const group of optionGroups) {
    const selectedIds = Array.from(new Set(selectedChoiceIds[group.id] ?? []));
    const selectedChoices = group.choices.filter(choice =>
      selectedIds.includes(choice.id)
    );

    if (
      selectedChoices.length < group.minSelections ||
      selectedChoices.length > group.maxSelections
    ) {
      const expected =
        group.minSelections === group.maxSelections
          ? `${group.minSelections}`
          : `${group.minSelections} a ${group.maxSelections}`;
      throw new Error(
        `Selecione ${expected} opção(ões) em “${group.name}”.`
      );
    }

    if (selectedChoices.length > 0) {
      summaryParts.push(
        `${group.name}: ${selectedChoices.map(choice => choice.name).join(', ')}`
      );
    }

    selectedChoices.forEach(choice => {
      selectedOptions.push({
        groupId: group.id,
        groupName: group.name,
        choiceId: choice.id,
        choiceName: choice.name,
        priceDelta: choice.priceDelta,
      });
    });
  }

  const basePrice = product.isComplimentary ? 0 : product.price;
  const unitPrice = Number(
    (
      basePrice +
      selectedOptions.reduce((sum, option) => sum + option.priceDelta, 0)
    ).toFixed(2)
  );
  const lineKey = getCartLineKey(product.id, selectedOptions);
  const customizationSummary = summaryParts.join(' · ');
  const cartProduct: Product = {
    ...product,
    id: lineKey,
    sourceProductId: product.sourceProductId ?? product.id,
    name: customizationSummary
      ? `${product.name} — ${customizationSummary}`
      : product.name,
    price: unitPrice,
    selectedOptions: [...selectedOptions],
    customizationSummary,
  };

  return {
    ...cartProduct,
    lineKey,
    product,
    unitPrice,
    selectedOptions,
    customizationSummary,
  };
};

export const configurationSelectionToCartProduct = (
  selection: ProductConfigurationSelection
): Product => ({
  ...selection,
  optionGroups: selection.product.optionGroups,
  categoryCollections: selection.product.categoryCollections,
});
