export const KYRUB_FINANCIAL_PROFILE_SCHEMA_VERSION = 1 as const;

export type KyrubFinancialOnboardingStatus =
  | 'not_started'
  | 'identity_required'
  | 'provider_pending'
  | 'under_review'
  | 'active'
  | 'restricted'
  | 'rejected';

export type KyrubFinancialCapability =
  | 'receive'
  | 'refund'
  | 'payout'
  | 'pix'
  | 'split';

export type KyrubFinancialProviderBinding = {
  provider: string;
  environment: 'sandbox' | 'production';
  externalRecipientId: string;
  status: 'pending' | 'active' | 'restricted' | 'disabled';
  verifiedAt?: string;
};

export type KyrubFinancialProfile = {
  schemaVersion: typeof KYRUB_FINANCIAL_PROFILE_SCHEMA_VERSION;
  userId: string;
  status: KyrubFinancialOnboardingStatus;
  capabilities: KyrubFinancialCapability[];
  providerBindings: KyrubFinancialProviderBinding[];
  createdAt: string;
  updatedAt: string;
};

export const canKyrubFinancialProfileReceive = (
  profile: Pick<KyrubFinancialProfile, 'status' | 'capabilities'>
): boolean =>
  profile.status === 'active' && profile.capabilities.includes('receive');
