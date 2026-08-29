export const ADMIN_PLATFORM_ECONOMY_PERIODS = ['7d', '30d', '90d', 'all'] as const;

export type AdminPlatformEconomyPeriod =
  (typeof ADMIN_PLATFORM_ECONOMY_PERIODS)[number];

export interface AdminPlatformEconomyPeriodScope {
  period: AdminPlatformEconomyPeriod;
  since: string | null;
  until: string;
}

const PERIOD_DAYS: Record<Exclude<AdminPlatformEconomyPeriod, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

export const parseAdminPlatformEconomyPeriod = (
  value: unknown
): AdminPlatformEconomyPeriod => {
  if (typeof value !== 'string') return 'all';
  const normalized = value.trim().toLowerCase();
  return ADMIN_PLATFORM_ECONOMY_PERIODS.includes(
    normalized as AdminPlatformEconomyPeriod
  )
    ? normalized as AdminPlatformEconomyPeriod
    : 'all';
};

export const resolveAdminPlatformEconomyPeriodScope = (
  periodInput: AdminPlatformEconomyPeriod,
  nowInput: Date = new Date()
): AdminPlatformEconomyPeriodScope => {
  const nowMs = nowInput.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new Error('ADMIN_PLATFORM_ECONOMY_PERIOD_NOW_INVALID');
  }

  const period = parseAdminPlatformEconomyPeriod(periodInput);
  const until = new Date(nowMs).toISOString();
  if (period === 'all') {
    return { period, since: null, until };
  }

  const days = PERIOD_DAYS[period];
  const sinceMs = nowMs - days * 24 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(sinceMs)) {
    throw new Error('ADMIN_PLATFORM_ECONOMY_PERIOD_RANGE_INVALID');
  }

  return {
    period,
    since: new Date(sinceMs).toISOString(),
    until,
  };
};
