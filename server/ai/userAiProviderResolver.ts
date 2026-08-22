import type { KyrubiaAiProviderId } from '../../shared/kyrubiaAiRouting.js';
import {
  resolveAuthorizedUserAiProviderSecret,
  type SupportedUserAiProvider,
} from './userAiProviderCredentialService.js';
import { adminDb } from '../firebaseAdmin.js';

export type UserAiProviderPreference = SupportedUserAiProvider | null;

export type UserAiProviderSelection =
  | {
      status: 'selected';
      provider: SupportedUserAiProvider;
      selection: 'explicit' | 'single_available';
    }
  | {
      status: 'selection_required';
      availableProviders: SupportedUserAiProvider[];
    }
  | {
      status: 'unavailable';
      availableProviders: [];
    };

export type UserAiProviderResolution =
  | {
      status: 'available';
      provider: SupportedUserAiProvider;
      apiKey: string;
      selection: 'explicit' | 'single_available';
    }
  | Extract<UserAiProviderSelection, { status: 'selection_required' | 'unavailable' }>;

const supportedProviders: readonly SupportedUserAiProvider[] = [
  'google-gemini',
  'openai',
  'anthropic',
];

export const isSupportedUserAiProvider = (
  value: unknown
): value is SupportedUserAiProvider =>
  typeof value === 'string' &&
  supportedProviders.includes(value as SupportedUserAiProvider);

export const providerDisplayName = (provider: KyrubiaAiProviderId): string => {
  if (provider === 'google-gemini') return 'Gemini';
  if (provider === 'openai') return 'OpenAI';
  if (provider === 'anthropic') return 'Anthropic';
  return 'Provedor personalizado';
};

export const decideUserAiProviderSelection = (input: {
  availableProviders: SupportedUserAiProvider[];
  preferredProvider?: UserAiProviderPreference;
}): UserAiProviderSelection => {
  const availableProviders = [...new Set(input.availableProviders)].filter(
    isSupportedUserAiProvider
  );
  if (availableProviders.length === 0) {
    return { status: 'unavailable', availableProviders: [] };
  }

  const preferred = input.preferredProvider ?? null;
  if (preferred && availableProviders.includes(preferred)) {
    return {
      status: 'selected',
      provider: preferred,
      selection: 'explicit',
    };
  }

  if (availableProviders.length === 1) {
    return {
      status: 'selected',
      provider: availableProviders[0],
      selection: 'single_available',
    };
  }

  return {
    status: 'selection_required',
    availableProviders,
  };
};

const availableProvidersFor = async (
  uid: string
): Promise<SupportedUserAiProvider[]> => {
  const snapshots = await Promise.all(
    supportedProviders.map(provider =>
      adminDb.doc(`users/${uid}/server_private_ai/${provider}`).get()
    )
  );
  return supportedProviders.filter((provider, index) => {
    const snapshot = snapshots[index];
    return snapshot?.exists && snapshot.data()?.status === 'available';
  });
};

export const resolveUserAiProvider = async (input: {
  uid: string;
  preferredProvider?: UserAiProviderPreference;
}): Promise<UserAiProviderResolution> => {
  const uid = input.uid.trim();
  if (!uid) {
    return { status: 'unavailable', availableProviders: [] };
  }

  const availableProviders = await availableProvidersFor(uid);
  const selection = decideUserAiProviderSelection({
    availableProviders,
    preferredProvider: input.preferredProvider,
  });
  if (selection.status !== 'selected') return selection;

  const secret = await resolveAuthorizedUserAiProviderSecret(
    uid,
    selection.provider
  );
  if (!secret) {
    return { status: 'unavailable', availableProviders: [] };
  }

  return {
    status: 'available',
    provider: secret.provider,
    apiKey: secret.apiKey,
    selection: selection.selection,
  };
};
