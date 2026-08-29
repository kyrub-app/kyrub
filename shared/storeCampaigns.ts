import type { StoreCrmCustomerSummary } from './storeCrm.js';

export const STORE_CAMPAIGN_SCHEMA_VERSION = 1 as const;
export const STORE_CAMPAIGN_MAX_TITLE_LENGTH = 120;
export const STORE_CAMPAIGN_MAX_BODY_LENGTH = 500;
export const STORE_CAMPAIGN_MAX_PREVIEW_SAMPLE = 10;

export type StoreCampaignSegment =
  | 'all_customers'
  | 'customers'
  | 'recurring'
  | 'frequent'
  | 'loyal'
  | 'points_positive'
  | 'active_challenge';

export type StoreCampaignStatus = 'sent';
export type StoreCampaignDeliveryStatus =
  | 'delivered'
  | 'skipped_no_marketing_consent';

export interface StoreCampaignAudienceMemberPreview {
  customerId: string;
  displayName: string;
  levelLabel: string;
  confirmedPurchases: number;
  pointsBalance: number;
  marketingEligible: boolean;
}

export interface StoreCampaignAudiencePreview {
  schemaVersion: typeof STORE_CAMPAIGN_SCHEMA_VERSION;
  storeId: string;
  segment: StoreCampaignSegment;
  candidateCount: number;
  marketingEligibleCount: number;
  skippedNoMarketingConsentCount: number;
  sample: StoreCampaignAudienceMemberPreview[];
  generatedAt: string;
}

export interface StoreCampaignRecord {
  schemaVersion: typeof STORE_CAMPAIGN_SCHEMA_VERSION;
  id: string;
  storeId: string;
  actorPrincipalId: string;
  segment: StoreCampaignSegment;
  title: string;
  body: string;
  status: StoreCampaignStatus;
  candidateCount: number;
  deliveredCount: number;
  skippedNoMarketingConsentCount: number;
  idempotencyKeyHash: string;
  requestFingerprint: string;
  createdAt: string;
  sentAt: string;
}

export interface StoreCampaignDeliveryRecord {
  schemaVersion: typeof STORE_CAMPAIGN_SCHEMA_VERSION;
  campaignId: string;
  storeId: string;
  customerId: string;
  status: StoreCampaignDeliveryStatus;
  notificationId: string;
  createdAt: string;
}

export interface SendStoreCampaignResult {
  campaign: StoreCampaignRecord;
  duplicate: boolean;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const validPathId = (value: string): boolean =>
  Boolean(value) && value.length <= 160 && !value.includes('/');

export const STORE_CAMPAIGN_SEGMENTS: ReadonlyArray<{
  id: StoreCampaignSegment;
  label: string;
  description: string;
}> = [
  {
    id: 'all_customers',
    label: 'Todos do CRM',
    description: 'Qualquer cliente com relacionamento canônico nesta loja.',
  },
  {
    id: 'customers',
    label: 'Clientes com compra',
    description: 'Pelo menos uma compra confirmada.',
  },
  {
    id: 'recurring',
    label: 'Recorrentes',
    description: 'Três ou mais compras confirmadas.',
  },
  {
    id: 'frequent',
    label: 'Frequentes',
    description: 'Dez ou mais compras confirmadas.',
  },
  {
    id: 'loyal',
    label: 'Fiéis',
    description: 'Vinte e cinco ou mais compras confirmadas.',
  },
  {
    id: 'points_positive',
    label: 'Com pontos',
    description: 'Saldo positivo de Pontos da Loja.',
  },
  {
    id: 'active_challenge',
    label: 'Em desafios',
    description: 'Participação ativa em pelo menos um desafio da loja.',
  },
] as const;

const SEGMENT_IDS = new Set<StoreCampaignSegment>(
  STORE_CAMPAIGN_SEGMENTS.map(segment => segment.id)
);

export const normalizeStoreCampaignSegment = (
  value: unknown
): StoreCampaignSegment => {
  const segment = clean(value) as StoreCampaignSegment;
  if (!SEGMENT_IDS.has(segment)) throw new Error('STORE_CAMPAIGN_SEGMENT_INVALID');
  return segment;
};

export const matchesStoreCampaignSegment = (
  customer: StoreCrmCustomerSummary,
  segment: StoreCampaignSegment
): boolean => {
  if (segment === 'all_customers') return true;
  if (segment === 'customers') return customer.confirmedPurchases >= 1;
  if (segment === 'recurring') return customer.confirmedPurchases >= 3;
  if (segment === 'frequent') return customer.confirmedPurchases >= 10;
  if (segment === 'loyal') return customer.confirmedPurchases >= 25;
  if (segment === 'points_positive') return customer.pointsBalance > 0;
  return customer.activeChallenges > 0;
};

export const normalizeStoreCampaignTitle = (value: unknown): string => {
  const title = clean(value);
  if (!title) throw new Error('STORE_CAMPAIGN_TITLE_REQUIRED');
  if (title.length > STORE_CAMPAIGN_MAX_TITLE_LENGTH) {
    throw new Error('STORE_CAMPAIGN_TITLE_TOO_LONG');
  }
  return title;
};

export const normalizeStoreCampaignBody = (value: unknown): string => {
  const body = clean(value);
  if (!body) throw new Error('STORE_CAMPAIGN_BODY_REQUIRED');
  if (body.length > STORE_CAMPAIGN_MAX_BODY_LENGTH) {
    throw new Error('STORE_CAMPAIGN_BODY_TOO_LONG');
  }
  return body;
};

export const normalizeStoreCampaignIdempotencyKey = (value: unknown): string => {
  const key = clean(value);
  if (!key || key.length > 160 || !/^[a-zA-Z0-9_-]+$/.test(key)) {
    throw new Error('STORE_CAMPAIGN_IDEMPOTENCY_KEY_INVALID');
  }
  return key;
};

export const storeCampaignPath = (storeIdInput: string, campaignIdInput: string): string => {
  const storeId = clean(storeIdInput);
  const campaignId = clean(campaignIdInput);
  if (!validPathId(storeId) || !validPathId(campaignId)) {
    throw new Error('STORE_CAMPAIGN_PATH_INVALID');
  }
  return `stores/${storeId}/campaigns/${campaignId}`;
};

export const storeCampaignDeliveryPath = (
  storeIdInput: string,
  campaignIdInput: string,
  customerIdInput: string
): string => {
  const customerId = clean(customerIdInput);
  if (!validPathId(customerId)) throw new Error('STORE_CAMPAIGN_PATH_INVALID');
  return `${storeCampaignPath(storeIdInput, campaignIdInput)}/deliveries/${customerId}`;
};
