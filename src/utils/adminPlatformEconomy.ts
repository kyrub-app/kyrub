import type { User } from 'firebase/auth';
import type { AdminPlatformEconomySnapshot } from '../../shared/adminPlatformEconomy';
import type { AdminPlatformEconomyPeriod } from '../../shared/adminPlatformEconomyPeriod';

export const loadAdminPlatformEconomy = async (
  user: Pick<User, 'getIdToken'>,
  period: AdminPlatformEconomyPeriod = 'all'
): Promise<AdminPlatformEconomySnapshot> => {
  const token = await user.getIdToken();
  const query = new URLSearchParams({ period });
  const response = await fetch(`/api/admin/platform-economy?${query.toString()}`, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });
  const payload = await response.json() as
    | AdminPlatformEconomySnapshot
    | { error?: string; code?: string };
  if (!response.ok) {
    throw new Error(
      'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : 'Não foi possível consultar a economia da plataforma.'
    );
  }
  return payload as AdminPlatformEconomySnapshot;
};
