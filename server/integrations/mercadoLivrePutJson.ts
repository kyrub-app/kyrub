import { getValidMercadoLivreAccessToken } from './mercadoLivreOauthService.js';

const MERCADO_LIVRE_API_ORIGIN = 'https://api.mercadolibre.com';

export const mercadoLivrePutJson = async <T>(storeId: string, path: string, body: unknown): Promise<T> => {
  const secret = await getValidMercadoLivreAccessToken(storeId);
  const url = new URL(path, MERCADO_LIVRE_API_ORIGIN);
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${secret.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`MERCADO_LIVRE_API_FAILED:HTTP_${response.status}`);
  return response.json() as Promise<T>;
};
