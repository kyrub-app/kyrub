import { mercadoLivreGetJson } from './mercadoLivreOauthService.js';

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const recordFrom = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.map(item => clean(item, 120)).filter(Boolean))] : [];

const parseValues = (value: unknown): Array<{ id: string; name: string }> => {
  if (!Array.isArray(value)) return [];
  return value.flatMap(candidate => {
    const record = recordFrom(candidate);
    const id = clean(record.id, 160);
    const name = clean(record.name, 255);
    return id || name ? [{ id, name: name || id }] : [];
  }).slice(0, 200);
};

const categoryShippingModes = (value: unknown): string[] => {
  const record = recordFrom(value);
  const modes = stringArray(record.modes);
  const logistics = Array.isArray(record.logistics) ? record.logistics : [];
  for (const candidate of logistics) {
    const mode = clean(recordFrom(candidate).mode, 120);
    if (mode && !modes.includes(mode)) modes.push(mode);
  }
  return modes;
};

export interface MercadoLivreSaleTermMetadata {
  id: string;
  name: string;
  valueType: string;
  required: boolean;
  values: Array<{ id: string; name: string }>;
  allowedUnits: Array<{ id: string; name: string }>;
  defaultUnit: string;
}

export interface MercadoLivreCommercialRequirements {
  saleTerms: MercadoLivreSaleTermMetadata[];
  shipping: {
    sellerModes: string[];
    categoryModes: string[];
    allowedModes: string[];
    localPickUpAvailable: boolean;
  };
}

export interface MercadoLivreSaleTermSelection {
  id: string;
  valueId?: string;
  valueName?: string;
}

export interface MercadoLivreShippingSelection {
  mode: string;
  freeShipping: boolean;
  localPickUp: boolean;
}

export const inspectMercadoLivreCommercialRequirements = async (input: {
  storeId: string;
  categoryId: string;
  externalAccountId: string;
}): Promise<MercadoLivreCommercialRequirements> => {
  const storeId = clean(input.storeId, 160);
  const categoryId = clean(input.categoryId, 160);
  const externalAccountId = clean(input.externalAccountId, 160);
  if (!storeId || !categoryId || !externalAccountId) {
    throw new Error('MERCADO_LIVRE_COMMERCIAL_REQUIREMENTS_TARGET_INVALID');
  }

  const [saleTermsRaw, sellerShippingRaw, categoryShippingRaw] = await Promise.all([
    mercadoLivreGetJson<unknown>(storeId, `/categories/${encodeURIComponent(categoryId)}/sale_terms`),
    mercadoLivreGetJson<unknown>(storeId, `/users/${encodeURIComponent(externalAccountId)}/shipping_preferences`),
    mercadoLivreGetJson<unknown>(storeId, `/categories/${encodeURIComponent(categoryId)}/shipping_preferences`),
  ]);

  const saleTerms = (Array.isArray(saleTermsRaw) ? saleTermsRaw : []).flatMap(candidate => {
    const record = recordFrom(candidate);
    const id = clean(record.id, 160);
    if (!id) return [];
    const tags = recordFrom(record.tags);
    return [{
      id,
      name: clean(record.name, 255) || id,
      valueType: clean(record.value_type, 80),
      required: tags.required === true,
      values: parseValues(record.values),
      allowedUnits: parseValues(record.allowed_units),
      defaultUnit: clean(record.default_unit, 80),
    }];
  });

  const sellerShipping = recordFrom(sellerShippingRaw);
  const sellerModes = stringArray(sellerShipping.modes);
  const categoryModes = categoryShippingModes(categoryShippingRaw);
  const allowedModes = categoryModes.length
    ? sellerModes.filter(mode => categoryModes.includes(mode))
    : [...sellerModes];

  return {
    saleTerms,
    shipping: {
      sellerModes,
      categoryModes,
      allowedModes,
      localPickUpAvailable: sellerShipping.local_pick_up === true,
    },
  };
};

const normalizedSaleTerms = (
  value: unknown,
  metadata: MercadoLivreSaleTermMetadata[]
): MercadoLivreSaleTermSelection[] => {
  if (!Array.isArray(value)) return [];
  const metadataById = new Map(metadata.map(item => [item.id, item]));
  const seen = new Set<string>();
  const result: MercadoLivreSaleTermSelection[] = [];

  for (const candidate of value) {
    const record = recordFrom(candidate);
    const id = clean(record.id, 160);
    const valueId = clean(record.valueId ?? record.value_id, 160);
    const valueName = clean(record.valueName ?? record.value_name, 255);
    if (!id || seen.has(id) || (!valueId && !valueName)) continue;
    const definition = metadataById.get(id);
    if (!definition) throw new Error('MERCADO_LIVRE_OUTBOUND_SALE_TERM_UNAVAILABLE');

    if (definition.values.length) {
      const selected = definition.values.find(option =>
        (valueId && option.id === valueId) ||
        (!valueId && valueName && option.name.toLocaleLowerCase('pt-BR') === valueName.toLocaleLowerCase('pt-BR'))
      );
      if (!selected) throw new Error('MERCADO_LIVRE_OUTBOUND_SALE_TERM_VALUE_INVALID');
      result.push({ id, ...(selected.id ? { valueId: selected.id } : {}), valueName: selected.name });
    } else {
      if (!valueName) throw new Error('MERCADO_LIVRE_OUTBOUND_SALE_TERM_VALUE_INVALID');
      if (definition.allowedUnits.length) {
        const normalized = valueName.toLocaleLowerCase('pt-BR');
        const allowedUnit = definition.allowedUnits.some(unit =>
          normalized.endsWith(` ${unit.name.toLocaleLowerCase('pt-BR')}`) ||
          normalized.endsWith(` ${unit.id.toLocaleLowerCase('pt-BR')}`)
        );
        if (!allowedUnit || !/^\d+(?:[.,]\d+)?\s+\S+/.test(valueName)) {
          throw new Error('MERCADO_LIVRE_OUTBOUND_SALE_TERM_UNIT_INVALID');
        }
      }
      result.push({ id, valueName });
    }
    seen.add(id);
  }
  return result;
};

const normalizedShipping = (
  value: unknown,
  requirements: MercadoLivreCommercialRequirements['shipping']
): MercadoLivreShippingSelection | null => {
  if (value === undefined || value === null) return null;
  const record = recordFrom(value);
  const mode = clean(record.mode, 120);
  const hasFreeShipping = typeof record.freeShipping === 'boolean' || typeof record.free_shipping === 'boolean';
  const hasLocalPickUp = typeof record.localPickUp === 'boolean' || typeof record.local_pick_up === 'boolean';
  if (!mode && !hasFreeShipping && !hasLocalPickUp) return null;
  if (!mode || !requirements.allowedModes.includes(mode)) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_SHIPPING_MODE_INVALID');
  }
  const freeShipping = typeof record.freeShipping === 'boolean'
    ? record.freeShipping
    : record.free_shipping === true;
  const localPickUp = typeof record.localPickUp === 'boolean'
    ? record.localPickUp
    : record.local_pick_up === true;
  if (localPickUp && !requirements.localPickUpAvailable) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_LOCAL_PICKUP_UNAVAILABLE');
  }
  return { mode, freeShipping, localPickUp };
};

export const validateMercadoLivreCommercialSelections = (input: {
  saleTerms: unknown;
  shipping: unknown;
  requirements: MercadoLivreCommercialRequirements;
}): {
  saleTerms: MercadoLivreSaleTermSelection[];
  shipping: MercadoLivreShippingSelection | null;
  missingRequiredSaleTermIds: string[];
} => {
  const saleTerms = normalizedSaleTerms(input.saleTerms, input.requirements.saleTerms);
  const suppliedSaleTermIds = new Set(saleTerms.map(term => term.id));
  const missingRequiredSaleTermIds = input.requirements.saleTerms
    .filter(term => term.required && !suppliedSaleTermIds.has(term.id))
    .map(term => term.id);
  const shipping = normalizedShipping(input.shipping, input.requirements.shipping);
  return { saleTerms, shipping, missingRequiredSaleTermIds };
};
