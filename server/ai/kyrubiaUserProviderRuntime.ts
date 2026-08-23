import type { KyrubiaAiProviderId } from '../../shared/kyrubiaAiRouting.js';
import {
  callKyrubiaUserProvider,
  type KyrubiaProviderResponse,
  type KyrubiaProviderToolDefinition,
  type KyrubiaProviderTurn,
  KyrubiaUserProviderAdapterError,
} from './kyrubiaUserProviderAdapters.js';
import { resolveUserAiProvider } from './userAiProviderResolver.js';
import type { SupportedUserAiProvider } from './userAiProviderCredentialService.js';

export type KyrubiaTextRuntimeMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type KyrubiaTextRuntimeToolDeclaration = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
};

export type KyrubiaUserProviderRuntimeResult =
  | {
      status: 'user_provider';
      provider: SupportedUserAiProvider;
      model: string;
      response: KyrubiaProviderResponse;
    }
  | {
      status: 'legacy_allowed';
      reason: 'no_user_provider' | 'multimodal_not_normalized';
    }
  | {
      status: 'selection_required';
      availableProviders: SupportedUserAiProvider[];
    }
  | {
      status: 'provider_failed';
      provider: SupportedUserAiProvider;
      code: string;
      message: string;
    };

const defaultModelFor = (provider: SupportedUserAiProvider): string => {
  if (provider === 'google-gemini') {
    return process.env.KYRUBIA_USER_GEMINI_MODEL?.trim() || 'gemini-3.6-flash';
  }
  if (provider === 'openai') {
    return process.env.KYRUBIA_USER_OPENAI_MODEL?.trim() || 'gpt-5.6';
  }
  return process.env.KYRUBIA_USER_ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5';
};

const normalizeJsonSchemaType = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const mapping: Record<string, string> = {
    OBJECT: 'object',
    STRING: 'string',
    ARRAY: 'array',
    BOOLEAN: 'boolean',
    NUMBER: 'number',
    INTEGER: 'integer',
  };
  return mapping[value] ?? value.toLowerCase();
};

const normalizeSchema = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeSchema);
  if (!value || typeof value !== 'object') return normalizeJsonSchemaType(value);
  const source = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(source).map(([key, item]) => [
      key,
      key === 'type' ? normalizeJsonSchemaType(item) : normalizeSchema(item),
    ])
  );
};

export const normalizeKyrubiaProviderTools = (
  declarations: KyrubiaTextRuntimeToolDeclaration[]
): KyrubiaProviderToolDefinition[] =>
  declarations
    .filter(declaration => declaration.name.trim())
    .map(declaration => ({
      name: declaration.name.trim(),
      ...(declaration.description?.trim()
        ? { description: declaration.description.trim() }
        : {}),
      parameters: normalizeSchema(declaration.parameters ?? {
        type: 'object',
        properties: {},
      }) as Record<string, unknown>,
    }));

export const messagesToKyrubiaProviderTurns = (
  messages: KyrubiaTextRuntimeMessage[]
): KyrubiaProviderTurn[] =>
  messages
    .filter(message => message.content.trim())
    .map(message => ({
      role: message.role,
      content: [{ type: 'text' as const, text: message.content }],
    }));

export const providerPublicName = (provider: KyrubiaAiProviderId): string => {
  if (provider === 'google-gemini') return 'Gemini';
  if (provider === 'openai') return 'OpenAI';
  if (provider === 'anthropic') return 'Anthropic';
  return 'IA conectada';
};

export const runKyrubiaUserProviderText = async (input: {
  uid: string;
  systemText: string;
  messages: KyrubiaTextRuntimeMessage[];
  turns?: KyrubiaProviderTurn[];
  tools: KyrubiaTextRuntimeToolDeclaration[];
  hasAttachments: boolean;
  signal?: AbortSignal;
}): Promise<KyrubiaUserProviderRuntimeResult> => {
  if (input.hasAttachments) {
    return {
      status: 'legacy_allowed',
      reason: 'multimodal_not_normalized',
    };
  }

  const resolved = await resolveUserAiProvider({ uid: input.uid });
  if (resolved.status === 'unavailable') {
    return { status: 'legacy_allowed', reason: 'no_user_provider' };
  }
  if (resolved.status === 'selection_required') {
    return {
      status: 'selection_required',
      availableProviders: resolved.availableProviders,
    };
  }

  const model = defaultModelFor(resolved.provider);
  try {
    const response = await callKyrubiaUserProvider({
      provider: resolved.provider,
      apiKey: resolved.apiKey,
      model,
      systemText: input.systemText,
      turns: input.turns ?? messagesToKyrubiaProviderTurns(input.messages),
      tools: normalizeKyrubiaProviderTools(input.tools),
      maxOutputTokens: 1_800,
      signal: input.signal,
    });
    return {
      status: 'user_provider',
      provider: resolved.provider,
      model: response.model,
      response,
    };
  } catch (error) {
    if (error instanceof KyrubiaUserProviderAdapterError) {
      return {
        status: 'provider_failed',
        provider: resolved.provider,
        code: error.code,
        message: error.message,
      };
    }
    return {
      status: 'provider_failed',
      provider: resolved.provider,
      code: 'AI_PROVIDER_UNAVAILABLE',
      message: 'A IA conectada não conseguiu responder agora.',
    };
  }
};
