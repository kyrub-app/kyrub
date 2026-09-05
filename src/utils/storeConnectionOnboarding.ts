import type { User } from 'firebase/auth';
import type { StoreCommerceChannelDeclaration } from '../../shared/storeConnectionOnboarding.js';
import type { KyrubCommerceChannel } from '../../shared/storeConnections.js';

const encoded = (value: string): string => encodeURIComponent(value.trim());

export const saveStoreCommerceChannelDeclaration = async (
  user: User,
  storeId: string,
  channels: KyrubCommerceChannel[]
): Promise<StoreCommerceChannelDeclaration> => {
  const token = await user.getIdToken();
  const response = await fetch(`/api/store-connections/${encoded(storeId)}/channels`, {
    method: 'PUT',
    cache: 'no-store',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ channels }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : `Não foi possível registrar os canais da loja (${response.status}).`;
    throw new Error(message);
  }
  return payload as unknown as StoreCommerceChannelDeclaration;
};
