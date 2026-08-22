import type { KyrubiaAiProviderId } from '../../shared/kyrubiaAiRouting.js';
import {
  resolveAuthorizedUserAiProviderSecret,
  type SupportedUserAiProvider,
} from './userAiProviderCredentialService.js';

export type UserAiProviderPreference = SupportedUserAiProvider | null;

export type UserAiProviderResolution =
  | {
      status: 'available';
      provider: SupportedUserAiProvider;
      apiKey: string;
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

const availableSecretsFor = async (
  uid: string
): Promise<Array<{ provider: SupportedUserAiProvider; apiKey: string }>> => {
  const resolved = await Promise.all(
    supportedProviders.map(provider =>
      resolveAuthorizedUserAiProviderSecret(uid, provider)
    )
  );
  return resolved.filter(
    (candidate): candidate is { provider: SupportedUserAiProvider; apiKey: string } =>
      Boolean(candidate)
  );
};

export const resolveUserAiProvider = async (input: {
  uid: string;
  preferredProvider?: UserAiProviderPreference;
}): Promise<UserAiProviderResolution> => {
  const uid = input.uid.trim();
  if (!uid) {
    return { status: 'unavailable', availableProviders: [] };
  }

  const available = await availableSecretsFor(uid);
  if (available.length === 0) {
    return { status: 'unavailable', availableProviders: [] };
  }

  const preferred = input.preferredProvider ?? null;
  if (preferred) {
    const selected = available.find(candidate => candidate.provider === preferred);
    if (selected) {
      return {
        status: 'available',
        provider: selected.provider,
        apiKey: selected.apiKey,
        selection: 'explicit',
      };
    }
  }

  if (available.length === 1) {
    const selected = available[0];
    return {
      status: 'available',
      provider: selected.provider,
      apiKey: selected.apiKey,
      selection: 'single_available',
    };
  }

  return {
    status: 'selection_required',
    availableProviders: available.map(candidate => candidate.provider),
  };
};
