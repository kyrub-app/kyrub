import type {
  SendStoreCampaignResult,
  StoreCampaignAudiencePreview,
  StoreCampaignRecord,
  StoreCampaignSegment,
} from '../../shared/storeCampaigns';
import { auth } from './firebase';

const currentUser = () => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente para acessar campanhas.');
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

const json = async <T>(response: Response): Promise<T> => {
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'As campanhas estão temporariamente indisponíveis.'
    );
  }
  return payload as T;
};

export const previewStoreCampaign = async (input: {
  storeId: string;
  segment: StoreCampaignSegment;
}): Promise<StoreCampaignAudiencePreview> =>
  json<StoreCampaignAudiencePreview>(
    await authorizedFetch(
      `/api/store-campaigns/preview?storeId=${encodeURIComponent(input.storeId)}&segment=${encodeURIComponent(input.segment)}`
    )
  );

export const listStoreCampaigns = async (
  storeId: string
): Promise<StoreCampaignRecord[]> => {
  const payload = await json<{ campaigns: StoreCampaignRecord[] }>(
    await authorizedFetch(
      `/api/store-campaigns?storeId=${encodeURIComponent(storeId)}`
    )
  );
  return Array.isArray(payload.campaigns) ? payload.campaigns : [];
};

export const sendStoreCampaign = async (input: {
  storeId: string;
  segment: StoreCampaignSegment;
  title: string;
  body: string;
  idempotencyKey: string;
}): Promise<SendStoreCampaignResult> =>
  json<SendStoreCampaignResult>(
    await authorizedFetch('/api/store-campaigns/send', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  );
