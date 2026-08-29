import type {
  UserCommunicationCategoryPreferences,
  UserCommunicationPreferences,
} from '../../shared/userCommunicationPreferences';
import { auth } from './firebase';

const currentUser = () => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente para alterar suas preferências.');
  return user;
};

const json = async <T>(response: Response): Promise<T> => {
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'As preferências estão temporariamente indisponíveis.'
    );
  }
  return payload as T;
};

const authorizedFetch = async (
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> => {
  const user = currentUser();
  const token = await user.getIdToken();
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

export const loadUserCommunicationPreferences = async (): Promise<UserCommunicationPreferences> =>
  json<UserCommunicationPreferences>(
    await authorizedFetch('/api/communication-preferences')
  );

export const saveUserCommunicationPreferences = async (input: {
  marketingEnabled: boolean;
  browserEnabled: boolean;
  categories: UserCommunicationCategoryPreferences;
}): Promise<UserCommunicationPreferences> =>
  json<UserCommunicationPreferences>(
    await authorizedFetch('/api/communication-preferences', {
      method: 'PUT',
      body: JSON.stringify({
        marketingEnabled: input.marketingEnabled,
        browserEnabled: input.browserEnabled,
        categories: input.categories,
      }),
    })
  );
