import type { StaffNoticeForViewer } from '../../shared/staffNotices';
import { auth } from './firebase';

const authorizedRequest = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Entre na sua conta para acessar os avisos da equipe.');
  const token = await user.getIdToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  const payload = await response.json() as { error?: string };
  if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar os avisos.');
  return payload as T;
};

export const listStaffNotices = async (storeId: string): Promise<StaffNoticeForViewer[]> => {
  const result = await authorizedRequest<{ notices: StaffNoticeForViewer[] }>(
    '/api/staff/notices?storeId=' + encodeURIComponent(storeId)
  );
  return result.notices;
};

export const publishStaffNotice = async (input: {
  storeId: string;
  requestId: string;
  title: string;
  body: string;
  audienceRoles: string[];
}): Promise<void> => {
  await authorizedRequest('/api/staff/notices', {
    method: 'POST', body: JSON.stringify(input),
  });
};

export const confirmStaffNoticeRead = async (
  storeId: string, noticeId: string
): Promise<string> => {
  const response = await authorizedRequest<{ readAt: string }>('/api/staff/notices/read', {
    method: 'POST', body: JSON.stringify({ storeId, noticeId }),
  });
  return response.readAt;
};
