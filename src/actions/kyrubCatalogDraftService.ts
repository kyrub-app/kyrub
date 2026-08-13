import type { User } from 'firebase/auth';
import type {
  KyrubCatalogDraftListItem,
  KyrubCatalogDraftListResponse,
} from '../../shared/kyrubCatalogDrafts';

const SAFE_ACTION_ENDPOINT = '/api/action-execute';

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

export const listKyrubCatalogDrafts = async (
  user: User
): Promise<KyrubCatalogDraftListResponse> => {
  let token = '';
  try {
    token = await user.getIdToken();
  } catch {
    throw new Error('Não foi possível validar sua sessão para listar os rascunhos.');
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
      body: JSON.stringify({ operation: 'list_catalog_drafts' }),
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch {
    throw new Error('Não foi possível consultar os rascunhos do catálogo agora.');
  }

  const body = await readBody(response);
  if (!response.ok) {
    const error = isRecord(body) && typeof body.error === 'string'
      ? body.error.trim()
      : '';
    throw new Error(error || 'Não foi possível consultar os rascunhos do catálogo agora.');
  }

  if (!isRecord(body) || !Array.isArray(body.drafts)) {
    throw new Error('O Kyrub respondeu sem uma lista válida de rascunhos.');
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
