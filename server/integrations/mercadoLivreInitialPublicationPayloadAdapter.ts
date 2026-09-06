import type {
  MercadoLivrePublicationModel,
  MercadoLivreStockAuthority,
} from './mercadoLivrePublicationCapabilityService.js';

export interface MercadoLivreInitialPublicationAttribute {
  id: string;
  valueId?: string;
  valueName?: string;
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
    attributes: input.attributes.map(attribute => ({
      id: clean(attribute.id, 160),
      ...(clean(attribute.valueId, 160) ? { value_id: clean(attribute.valueId, 160) } : {}),
      ...(clean(attribute.valueName, 600) ? { value_name: clean(attribute.valueName, 600) } : {}),
    })),
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
