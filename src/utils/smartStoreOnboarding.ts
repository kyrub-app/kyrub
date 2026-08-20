export const STORE_ONBOARDING_DRAFT_VERSION = 1 as const;

export type StoreOnboardingProfile = {
  name: string;
  description: string;
  address: string;
  contact: string;
  keywords: string;
};

export type StoreOnboardingField = keyof StoreOnboardingProfile;

export type StoreOnboardingStep = {
  id: StoreOnboardingField;
  label: string;
  required: boolean;
  complete: boolean;
};

export type StoreOnboardingProgress = {
  steps: StoreOnboardingStep[];
  completed: number;
  total: number;
  percent: number;
  nextField: StoreOnboardingField | null;
  readyForReview: boolean;
};

export type StoreOnboardingDraft = {
  version: typeof STORE_ONBOARDING_DRAFT_VERSION;
  lastField: StoreOnboardingField | null;
  updatedAt: string;
};

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STEP_DEFINITIONS: ReadonlyArray<{
  id: StoreOnboardingField;
  label: string;
  required: boolean;
}> = [
  { id: 'name', label: 'Nome da loja', required: true },
  { id: 'description', label: 'Descrição', required: false },
  { id: 'address', label: 'Endereço', required: false },
  { id: 'contact', label: 'Contato', required: true },
  { id: 'keywords', label: 'Palavras-chave', required: false },
];

const hasValue = (value: string): boolean => value.trim().length > 0;

export const getStoreOnboardingDraftKey = (uid: string): string =>
  `kyrub_store_onboarding_${uid}`;

export const getStoreOnboardingProgress = (
  profile: StoreOnboardingProfile
): StoreOnboardingProgress => {
  const steps = STEP_DEFINITIONS.map(definition => ({
    ...definition,
    complete: hasValue(profile[definition.id]),
  }));
  const completed = steps.filter(step => step.complete).length;
  const nextRequired = steps.find(step => step.required && !step.complete);
  const nextOptional = steps.find(step => !step.complete);

  return {
    steps,
    completed,
    total: steps.length,
    percent: Math.round((completed / steps.length) * 100),
    nextField: nextRequired?.id ?? nextOptional?.id ?? null,
    readyForReview: steps
      .filter(step => step.required)
      .every(step => step.complete),
  };
};

export const shouldOfferStoreOnboarding = (
  profile: StoreOnboardingProfile
): boolean => getStoreOnboardingProgress(profile).completed < STEP_DEFINITIONS.length;

export const createStoreOnboardingDraft = (
  lastField: StoreOnboardingField | null,
  now = new Date()
): StoreOnboardingDraft => ({
  version: STORE_ONBOARDING_DRAFT_VERSION,
  lastField,
  updatedAt: now.toISOString(),
});

const isStoreOnboardingField = (value: unknown): value is StoreOnboardingField =>
  STEP_DEFINITIONS.some(step => step.id === value);

export const loadStoreOnboardingDraft = (
  storage: StorageLike,
  uid: string
): StoreOnboardingDraft | null => {
  const serialized = storage.getItem(getStoreOnboardingDraftKey(uid));
  if (!serialized) return null;

  try {
    const value = JSON.parse(serialized) as Partial<StoreOnboardingDraft>;
    if (value.version !== STORE_ONBOARDING_DRAFT_VERSION) return null;
    if (value.lastField !== null && !isStoreOnboardingField(value.lastField)) return null;
    if (typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) {
      return null;
    }
    return value as StoreOnboardingDraft;
  } catch {
    return null;
  }
};

export const saveStoreOnboardingDraft = (
  storage: StorageLike,
  uid: string,
  draft: StoreOnboardingDraft
): void => {
  storage.setItem(getStoreOnboardingDraftKey(uid), JSON.stringify(draft));
};

export const clearStoreOnboardingDraft = (
  storage: StorageLike,
  uid: string
): void => storage.removeItem(getStoreOnboardingDraftKey(uid));
