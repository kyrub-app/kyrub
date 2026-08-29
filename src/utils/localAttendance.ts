import type { LocalAttendanceSession } from '../../shared/localAttendance';
import { auth } from './firebase';

const currentUser = () => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente para acessar o atendimento local.');
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
        : 'O atendimento local está temporariamente indisponível.'
    );
  }
  return payload as T;
};

export const loadLocalAttendanceSessions = async (
  storeId: string
): Promise<LocalAttendanceSession[]> => {
  const payload = await json<{ sessions: LocalAttendanceSession[] }>(
    await authorizedFetch(
      `/api/local-attendance?storeId=${encodeURIComponent(storeId)}`
    )
  );
  return Array.isArray(payload.sessions) ? payload.sessions : [];
};

export const openLocalAttendance = async (input: {
  storeId: string;
  customerLabel: string;
  space: string;
  itemCount: number;
}): Promise<LocalAttendanceSession> => {
  const payload = await json<{ session: LocalAttendanceSession }>(
    await authorizedFetch('/api/local-attendance/open', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  );
  return payload.session;
};

export const closeLocalAttendance = async (input: {
  storeId: string;
  attendanceId: string;
}): Promise<LocalAttendanceSession> => {
  const payload = await json<{ session: LocalAttendanceSession }>(
    await authorizedFetch(
      `/api/local-attendance/${encodeURIComponent(input.attendanceId)}/close`,
      {
        method: 'POST',
        body: JSON.stringify({ storeId: input.storeId }),
      }
    )
  );
  return payload.session;
};
