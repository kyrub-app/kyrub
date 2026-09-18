export const IN_PERSON_ORDER_MAX_LINES = 100;
export const IN_PERSON_ORDER_MAX_QUANTITY = 999;
export const IN_PERSON_ORDER_MAX_CUSTOMER_LABEL_LENGTH = 120;
export const IN_PERSON_ORDER_MAX_NOTE_LENGTH = 500;
export const IN_PERSON_ORDER_MAX_ITEM_NOTE_LENGTH = 240;

export interface InPersonOrderLineInput {
  productId: string;
  quantity: number;
  note: string;
}

export interface InPersonOrderCreateInput {
  storeId: string;
  serviceLocationId: string;
  customerLabel: string;
  customerNote: string;
  items: InPersonOrderLineInput[];
}

export interface InPersonCatalogProduct {
  id: string;
  name: string;
  price: number;
  image: string;
  stock: number;
  isService: boolean;
  publicationStatus: 'published' | 'paused';
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const validId = (value: string): boolean =>
  Boolean(value) && value.length <= 180 && !value.includes('/') && !value.includes('..');

const boundedText = (
  value: unknown,
  maximum: number,
  code: string
): string => {
  const normalized = clean(value);
  if (normalized.length > maximum) throw new Error(code);
  return normalized;
};

export const parseInPersonOrderCreateInput = (
  value: unknown
): InPersonOrderCreateInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('IN_PERSON_ORDER_INVALID');
  }
  const candidate = value as Record<string, unknown>;
  const storeId = clean(candidate.storeId);
  const serviceLocationId = clean(candidate.serviceLocationId);
  if (!validId(storeId)) throw new Error('IN_PERSON_ORDER_STORE_REQUIRED');
  if (!validId(serviceLocationId)) {
    throw new Error('IN_PERSON_ORDER_SERVICE_LOCATION_REQUIRED');
  }
  if (!Array.isArray(candidate.items) || candidate.items.length === 0) {
    throw new Error('IN_PERSON_ORDER_ITEMS_REQUIRED');
  }
  if (candidate.items.length > IN_PERSON_ORDER_MAX_LINES) {
    throw new Error('IN_PERSON_ORDER_TOO_MANY_LINES');
  }

  const seen = new Set<string>();
  const items = candidate.items.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('IN_PERSON_ORDER_ITEM_INVALID');
    }
    const record = item as Record<string, unknown>;
    const productId = clean(record.productId);
    const quantity = typeof record.quantity === 'number'
      ? record.quantity
      : Number(record.quantity);
    if (!validId(productId)) throw new Error('IN_PERSON_ORDER_PRODUCT_INVALID');
    if (seen.has(productId)) throw new Error('IN_PERSON_ORDER_PRODUCT_DUPLICATED');
    seen.add(productId);
    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > IN_PERSON_ORDER_MAX_QUANTITY
    ) {
      throw new Error('IN_PERSON_ORDER_QUANTITY_INVALID');
    }
    return {
      productId,
      quantity,
      note: boundedText(
        record.note,
        IN_PERSON_ORDER_MAX_ITEM_NOTE_LENGTH,
        'IN_PERSON_ORDER_ITEM_NOTE_TOO_LONG'
      ),
    } satisfies InPersonOrderLineInput;
  });

  return {
    storeId,
    serviceLocationId,
    customerLabel: boundedText(
      candidate.customerLabel,
      IN_PERSON_ORDER_MAX_CUSTOMER_LABEL_LENGTH,
      'IN_PERSON_ORDER_CUSTOMER_LABEL_TOO_LONG'
    ),
    customerNote: boundedText(
      candidate.customerNote,
      IN_PERSON_ORDER_MAX_NOTE_LENGTH,
      'IN_PERSON_ORDER_NOTE_TOO_LONG'
    ),
    items,
  };
};
