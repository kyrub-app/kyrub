import type {
  InPersonCatalogProduct,
  InPersonOrderCreateInput,
} from '../../shared/inPersonOrder';
import { parseCustomerOrder, type CustomerOrder } from './customerOrders';
import { auth } from './firebase';

const currentUser = () => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente para operar o PDV local.');
  return user;
};

const authorizedFetch = async (
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> => {
  const token = await currentUser().getIdToken();
  return fetch(input, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
      authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });
};

const payload = async (response: Response): Promise<Record<string, unknown>> => {
  const value = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof value.error === 'string'
        ? value.error
        : 'O PDV local está temporariamente indisponível.'
    );
  }
  return value;
};

const parseCatalogProduct = (value: unknown): InPersonCatalogProduct | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== 'string' ||
    !item.id.trim() ||
    typeof item.name !== 'string' ||
    !item.name.trim() ||
    typeof item.price !== 'number' ||
    !Number.isFinite(item.price) ||
    item.price < 0 ||
    typeof item.stock !== 'number' ||
    !Number.isSafeInteger(item.stock) ||
    item.stock < 0 ||
    item.publicationStatus !== 'published'
  ) return null;
  return {
    id: item.id.trim(),
    name: item.name.trim(),
    price: item.price,
    image: typeof item.image === 'string' ? item.image.trim() : '',
    stock: item.stock,
    isService: item.isService === true,
    publicationStatus: 'published',
  };
};

export const loadInPersonOrderCatalog = async (
  storeId: string
): Promise<InPersonCatalogProduct[]> => {
  const response = await authorizedFetch(
    `/api/local-attendance/orders/catalog?storeId=${encodeURIComponent(storeId.trim())}`
  );
  const value = await payload(response);
  const products = Array.isArray(value.products) ? value.products : [];
  return products.flatMap(item => {
    const parsed = parseCatalogProduct(item);
    return parsed ? [parsed] : [];
  });
};

export const createInPersonOrder = async (
  input: InPersonOrderCreateInput
): Promise<CustomerOrder> => {
  const response = await authorizedFetch('/api/local-attendance/orders', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  const value = await payload(response);
  const order = parseCustomerOrder(value.order);
  if (!order || order.source !== 'staff' || order.sourceChannel !== 'kyrub') {
    throw new Error('A confirmação do pedido presencial veio em formato inválido.');
  }
  return order;
};
