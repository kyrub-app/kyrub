import type { User } from 'firebase/auth';
import type { KyrubPlatformEconomicsSummary } from '../../shared/kyrubPlatformEconomics';
import { hasAdminPermission, type AdminProfile } from './adminControlPlane';

const finiteMinor = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : 0;

const finiteCount = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;

export const parseAdminPlatformEconomics = (
  value: unknown
): KyrubPlatformEconomicsSummary | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const totals = candidate.totals as Record<string, unknown> | undefined;
  const coverage = candidate.coverage as Record<string, unknown> | undefined;
  if (!totals || !coverage) return null;

  const slices = (raw: unknown) => Array.isArray(raw)
    ? raw.flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        const row = item as Record<string, unknown>;
        const key = typeof row.key === 'string' ? row.key.trim() : '';
        if (!key) return [];
        return [{
          key,
          ledgerCount: finiteCount(row.ledgerCount),
          gmvMinor: finiteMinor(row.gmvMinor),
          consumerPaidMinor: finiteMinor(row.consumerPaidMinor),
          platformRevenueMinor: finiteMinor(row.platformRevenueMinor),
          platformCostsMinor: finiteMinor(row.platformCostsMinor),
          platformNetMinor: finiteMinor(row.platformNetMinor),
        }];
      })
    : [];

  return {
    generatedAt: typeof candidate.generatedAt === 'string' ? candidate.generatedAt : '',
    scannedLedgers: finiteCount(candidate.scannedLedgers),
    includedLedgers: finiteCount(candidate.includedLedgers),
    truncated: candidate.truncated === true,
    totals: {
      gmvMinor: finiteMinor(totals.gmvMinor),
      consumerPaidMinor: finiteMinor(totals.consumerPaidMinor),
      discountsMinor: finiteMinor(totals.discountsMinor),
      freightMinor: finiteMinor(totals.freightMinor),
      tipsMinor: finiteMinor(totals.tipsMinor),
      subsidiesMinor: finiteMinor(totals.subsidiesMinor),
      incentivesMinor: finiteMinor(totals.incentivesMinor),
      platformRevenueMinor: finiteMinor(totals.platformRevenueMinor),
      financialCostsMinor: finiteMinor(totals.financialCostsMinor),
      taxesMinor: finiteMinor(totals.taxesMinor),
      workerEarningsMinor: finiteMinor(totals.workerEarningsMinor),
      platformCostsMinor: finiteMinor(totals.platformCostsMinor),
      platformNetMinor: finiteMinor(totals.platformNetMinor),
    },
    coverage: {
      transactionLedger: 'authoritative',
      infrastructureCosts: 'not_modeled',
      aiCosts: 'not_modeled',
    },
    byPaymentMethod: slices(candidate.byPaymentMethod),
    byProvider: slices(candidate.byProvider),
    byStore: slices(candidate.byStore),
  };
};

export const loadAdminPlatformEconomics = async (
  user: Pick<User, 'getIdToken'>,
  profile: AdminProfile
): Promise<KyrubPlatformEconomicsSummary> => {
  if (!hasAdminPermission(profile, 'read_finance')) {
    throw new Error('Seu papel não permite consultar a economia da plataforma.');
  }
  const token = await user.getIdToken();
  const response = await fetch('/api/admin/economics/summary', {
    headers: { authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'Não foi possível consultar a economia da plataforma.'
    );
  }
  const parsed = parseAdminPlatformEconomics(payload);
  if (!parsed) throw new Error('O servidor retornou dados econômicos inválidos.');
  return parsed;
};
