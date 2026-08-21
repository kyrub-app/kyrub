import type {
  KyrubFinancialCapability,
  KyrubFinancialOnboardingStatus,
  KyrubFinancialProfile,
  KyrubFinancialProviderBinding,
} from '../../shared/kyrubFinancialProfile.js';

const ALLOWED_TRANSITIONS: Record<KyrubFinancialOnboardingStatus, KyrubFinancialOnboardingStatus[]> = {
  not_started: ['identity_required'],
  identity_required: ['provider_pending', 'rejected'],
  provider_pending: ['under_review', 'active', 'restricted', 'rejected'],
  under_review: ['active', 'restricted', 'rejected'],
  active: ['restricted'],
  restricted: ['under_review', 'active', 'rejected'],
  rejected: ['identity_required'],
};

const clean = (value: unknown, maximum = 180): string =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : '';

const iso = (value: Date): string => value.toISOString();

export const createKyrubFinancialProfile = (input: {
  userId: string;
  now?: Date;
}): KyrubFinancialProfile => {
  const userId = clean(input.userId);
  if (!userId) throw new Error('FINANCIAL_PROFILE_USER_REQUIRED');
  const timestamp = iso(input.now ?? new Date());
  return {
    schemaVersion: 1,
    userId,
    status: 'not_started',
    capabilities: [],
    providerBindings: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export const transitionKyrubFinancialProfile = (input: {
  profile: KyrubFinancialProfile;
  status: KyrubFinancialOnboardingStatus;
  now?: Date;
}): KyrubFinancialProfile => {
  if (input.profile.status === input.status) return input.profile;
  if (!ALLOWED_TRANSITIONS[input.profile.status].includes(input.status)) {
    throw new Error(
      `FINANCIAL_PROFILE_INVALID_TRANSITION:${input.profile.status}->${input.status}`
    );
  }
  return {
    ...input.profile,
    status: input.status,
    updatedAt: iso(input.now ?? new Date()),
  };
};

export const bindKyrubFinancialProviderRecipient = (input: {
  profile: KyrubFinancialProfile;
  binding: KyrubFinancialProviderBinding;
  now?: Date;
}): KyrubFinancialProfile => {
  const provider = clean(input.binding.provider, 80);
  const externalRecipientId = clean(input.binding.externalRecipientId, 180);
  if (!provider || !externalRecipientId) {
    throw new Error('FINANCIAL_PROVIDER_BINDING_INVALID');
  }

  const binding: KyrubFinancialProviderBinding = {
    ...input.binding,
    provider,
    externalRecipientId,
  };
  const withoutSameProvider = input.profile.providerBindings.filter(
    current =>
      current.provider !== provider || current.environment !== binding.environment
  );
  return {
    ...input.profile,
    providerBindings: [...withoutSameProvider, binding],
    updatedAt: iso(input.now ?? new Date()),
  };
};

export const grantKyrubFinancialCapabilities = (input: {
  profile: KyrubFinancialProfile;
  capabilities: KyrubFinancialCapability[];
  now?: Date;
}): KyrubFinancialProfile => {
  if (input.profile.status !== 'active') {
    throw new Error('FINANCIAL_PROFILE_NOT_ACTIVE');
  }
  return {
    ...input.profile,
    capabilities: [...new Set([...input.profile.capabilities, ...input.capabilities])],
    updatedAt: iso(input.now ?? new Date()),
  };
};
