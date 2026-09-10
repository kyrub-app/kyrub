import type {
  MercadoLivrePublicationModel,
  MercadoLivreStockAuthority,
} from './mercadoLivrePublicationCapabilityService.js';

export interface MercadoLivreInitialPublicationAttribute {
  id: string;
  valueId?: string;
  valueName?: string;
}

export interface MercadoLivreInitialPublicationSaleTerm {
  id: string;
  valueId?: string;
  valueName?: string;
}

export interface MercadoLivreInitialPublicationShipping {
  mode: string;
  freeShipping: boolean;
  localPickUp: boolean;
}

export interface MercadoLivreInitialPublicationPayloadInput {
  publicationModel: MercadoLivrePublicationModel;
  stockAuthority: MercadoLivreStockAuthority;
  name: string;
  categoryId: string;
  price: number;
  currencyId: string;
  availableQuantity: number;
  listingTypeId: string;
  condition: string;
  pictureUrl?: string;
  pictureUrls?: readonly string[];
  attributes: MercadoLivreInitialPublicationAttribute[];
  saleTerms?: MercadoLivreInitialPublicationSaleTerm[];
  shipping?: MercadoLivreInitialPublicationShipping | null;
  sellerCustomField?: string;
}

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const normalizePictureUrls = (input: MercadoLivreInitialPublicationPayloadInput): string[] => {
  const candidates = [
    ...(Array.isArray(input.pictureUrls) ? input.pictureUrls : []),
    input.pictureUrl ?? '',
  ];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    const url = clean(candidate, 2_000);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
    if (result.length >= 12) break;
  }
  return result;
};

const providerValue = (value: MercadoLivreInitialPublicationAttribute | MercadoLivreInitialPublicationSaleTerm) => ({
  id: clean(value.id, 160),
  ...(clean(value.valueId, 160) ? { value_id: clean(value.valueId, 160) } : {}),
  ...(clean(value.valueName, 600) ? { value_name: clean(value.valueName, 600) } : {}),
});

export const buildMercadoLivreInitialPublicationPayload = (
  input: MercadoLivreInitialPublicationPayloadInput
): Record<string, unknown> => {
  const name = clean(input.name, 120);
  if (!name) throw new Error('MERCADO_LIVRE_PUBLICATION_NAME_REQUIRED');
  if (input.stockAuthority !== 'item_available_quantity') {
    throw new Error('MERCADO_LIVRE_STOCK_LOCATION_PUBLICATION_ADAPTER_REQUIRED');
  }
  if (input.publicationModel !== 'legacy_items' && input.publicationModel !== 'user_products') {
    throw new Error('MERCADO_LIVRE_PUBLICATION_MODEL_UNSUPPORTED');
  }

  const pictureUrls = normalizePictureUrls(input);
  const saleTerms = (input.saleTerms ?? []).filter(term => clean(term.id, 160));
  const shippingMode = clean(input.shipping?.mode, 120);
  const common = {
    category_id: clean(input.categoryId, 160),
    price: input.price,
    currency_id: clean(input.currencyId, 16),
    available_quantity: input.availableQuantity,
    buying_mode: 'buy_it_now',
    listing_type_id: clean(input.listingTypeId, 120),
    condition: clean(input.condition, 120),
    ...(clean(input.sellerCustomField, 120)
      ? { seller_custom_field: clean(input.sellerCustomField, 120) }
      : {}),
    ...(pictureUrls.length > 0
      ? { pictures: pictureUrls.map(source => ({ source })) }
      : {}),
    attributes: input.attributes.map(providerValue),
    ...(saleTerms.length > 0 ? { sale_terms: saleTerms.map(providerValue) } : {}),
    ...(shippingMode && input.shipping ? {
      shipping: {
        mode: shippingMode,
        free_shipping: input.shipping.freeShipping,
        local_pick_up: input.shipping.localPickUp,
      },
    } : {}),
  };

  if (input.publicationModel === 'user_products') {
    return {
      family_name: name,
      ...common,
    };
  }

  return {
    title: name,
    ...common,
  };
};
