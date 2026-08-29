import { deriveStoreRelationshipLevel, type StoreRelationshipLevel } from './storeRelationship.js';

export const STORE_CRM_SCHEMA_VERSION = 1 as const;
export const STORE_CRM_MAX_CUSTOMERS = 100 as const;

export interface StoreCrmCustomerSummary {
  customerId: string;
  displayName: string;
  photoUrl: string;
  confirmedPurchases: number;
  confirmedSpentMinor: number;
  lastActivityAt: string;
  pointsBalance: number;
  activeChallenges: number;
  completedChallenges: number;
  rewardRedemptions: number;
  level: StoreRelationshipLevel;
}

export interface StoreCrmSummary {
  schemaVersion: typeof STORE_CRM_SCHEMA_VERSION;
  storeId: string;
  generatedAt: string;
  customerCount: number;
  customers: StoreCrmCustomerSummary[];
}

export const buildStoreCrmCustomerSummary = (input: Omit<StoreCrmCustomerSummary, 'level'>): StoreCrmCustomerSummary => ({
  ...input,
  level: deriveStoreRelationshipLevel(input.confirmedPurchases),
});
