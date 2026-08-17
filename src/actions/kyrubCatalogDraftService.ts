import type { User } from 'firebase/auth';
import type { Product } from '../types';
import type {
  KyrubCatalogDraftListItem,
  KyrubCatalogDraftListResponse,
} from '../../shared/kyrubCatalogDrafts';

const SAFE_ACTION_ENDPOINT = '/api/action-execute';

export const KYRUB_CATALOG_PRODUCT_CHANGED_EVENT =
  'kyrub-catalog-product-changed';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readBody = async (response: Response): Promise<unknown> => {
  const text = await response.text().catch(() => '');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
};

const authenticatedPost = async (
  user: User,
  payload: Record<string, unknown>,
  fallbackError: string
): Promise<unknown> => {
  let token = '';
  try {
    token = await user.getIdToken();
  } catch {
    throw new Error('Não foi possível validar sua sessão para alterar o catálogo.');
  }

  let response: Response;
  try {
    response = await fetch(SAFE_ACTION_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch {
    throw new Error(fallbackError);
  }

  const body = await readBody(response);
  if (!response.ok) {
    const error = isRecord(body) && typeof body.error === 'string'
      ? body.error.trim()
      : '';
    throw new Error(error || fallbackError);
  }

  return body;
};

const dispatchCatalogProductChanged = (
  productId: string,
  detail: Record<string, unknown> = {}
): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(KYRUB_CATALOG_PRODUCT_CHANGED_EVENT, {
      detail: { productId, ...detail },
    })
  );
};

export const listKyrubCatalogDrafts = async (
  user: User
): Promise<KyrubCatalogDraftListResponse> => {
  const body = await authenticatedPost(
    user,
    { operation: 'list_catalog_drafts' },
    'Não foi possível consultar os produtos não publicados agora.'
  );

  if (!isRecord(body) || !Array.isArray(body.drafts)) {
    throw new Error('O Kyrub respondeu sem uma lista válida de produtos não publicados.');
  }

  return {
    drafts: body.drafts.filter(
      (item): item is KyrubCatalogDraftListItem =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        item.status === 'draft' &&
        isRecord(item.product) &&
        typeof item.product.name === 'string' &&
        Array.isArray(item.issues)
    ),
  };
};

export const updateKyrubCatalogProduct = async (
  user: User,
  product: Product
): Promise<'draft' | 'published'> => {
  const productId = product.id.trim();
  if (!productId) throw new Error('O produto não foi identificado.');

  const body = await authenticatedPost(
    user,
    {
      operation: 'update_catalog_product',
      productId,
      product: {
        name: product.name,
        description: product.description,
        price: product.price,
        image: product.image,
        stock: product.stock,
        category: product.category,
        isService: product.isService === true,
        isComplimentary: product.isComplimentary === true,
      },
    },
    'Não foi possível salvar as alterações do produto.'
  );

  if (
    !isRecord(body) ||
    body.productId !== productId ||
    (body.publicationStatus !== 'draft' && body.publicationStatus !== 'published')
  ) {
    throw new Error('O Kyrub não confirmou a atualização do produto.');
  }

  const publicationStatus = body.publicationStatus as 'draft' | 'published';
  dispatchCatalogProductChanged(productId, {
    publicationStatus,
    updated: true,
  });
  return publicationStatus;
};

export const setKyrubCatalogProductPublished = async (
  user: User,
  productId: string,
  published: boolean
): Promise<void> => {
  const normalizedId = productId.trim();
  if (!normalizedId) throw new Error('O produto não foi identificado.');

  const body = await authenticatedPost(
    user,
    {
      operation: 'set_catalog_product_publication',
      productId: normalizedId,
      published,
    },
    published
      ? 'Não foi possível publicar o produto agora.'
      : 'Não foi possível retirar o produto da vitrine agora.'
  );

  if (
    !isRecord(body) ||
    body.productId !== normalizedId ||
    body.publicationStatus !== (published ? 'published' : 'draft')
  ) {
    throw new Error('O Kyrub não confirmou a alteração de publicação do produto.');
  }

  dispatchCatalogProductChanged(normalizedId, { published });
};
