import type { SupportedUserAiProvider } from './userAiProviderCredentialService.js';

export type KyrubiaProviderToolDefinition = {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
};

export type KyrubiaProviderContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'tool_call';
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }
  | {
      type: 'tool_result';
      id: string;
      name: string;
      result: Record<string, unknown>;
    };

export type KyrubiaProviderTurn = {
  role: 'user' | 'assistant';
  content: KyrubiaProviderContentBlock[];
};

export type KyrubiaProviderRequest = {
  provider: SupportedUserAiProvider;
  apiKey: string;
  model: string;
  systemText: string;
  turns: KyrubiaProviderTurn[];
  tools?: KyrubiaProviderToolDefinition[];
  maxOutputTokens?: number;
  signal?: AbortSignal;
};

export type KyrubiaProviderUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type KyrubiaProviderResponse = {
  provider: SupportedUserAiProvider;
  model: string;
  text: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage: KyrubiaProviderUsage;
};

export type KyrubiaUserProviderAdapterCapabilities = {
  text: true;
  tools: true;
  multimodalNormalized: false;
};

export const KYRUBIA_USER_PROVIDER_ADAPTER_CAPABILITIES:
  Record<SupportedUserAiProvider, KyrubiaUserProviderAdapterCapabilities> = {
    'google-gemini': { text: true, tools: true, multimodalNormalized: false },
    openai: { text: true, tools: true, multimodalNormalized: false },
    anthropic: { text: true, tools: true, multimodalNormalized: false },
  };

export class KyrubiaUserProviderAdapterError extends Error {
  constructor(
    readonly provider: SupportedUserAiProvider,
    readonly status: number,
    readonly code:
      | 'AI_PROVIDER_CREDENTIAL_REJECTED'
      | 'AI_PROVIDER_LIMIT_REACHED'
      | 'AI_PROVIDER_MODEL_UNAVAILABLE'
      | 'AI_PROVIDER_UNAVAILABLE',
    message: string
  ) {
    super(message);
    this.name = 'KyrubiaUserProviderAdapterError';
  }
}

const safeJson = async (response: Response): Promise<Record<string, unknown>> => {
  const text = await response.text().catch(() => '');
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object'
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

const finiteToken = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : undefined;

const parseArguments = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return asRecord(parsed);
  } catch {
    return {};
  }
};

const normalizedMaxTokens = (value: number | undefined): number => {
  if (!value || !Number.isFinite(value)) return 1_800;
  return Math.min(8_192, Math.max(128, Math.trunc(value)));
};

const providerFailure = (
  provider: SupportedUserAiProvider,
  status: number
): KyrubiaUserProviderAdapterError => {
  if (status === 401 || status === 403) {
    return new KyrubiaUserProviderAdapterError(
      provider,
      400,
      'AI_PROVIDER_CREDENTIAL_REJECTED',
      'O provedor recusou a credencial conectada.'
    );
  }
  if (status === 429) {
    return new KyrubiaUserProviderAdapterError(
      provider,
      409,
      'AI_PROVIDER_LIMIT_REACHED',
      'A conta do provedor atingiu um limite temporário de uso.'
    );
  }
  if (status === 404) {
    return new KyrubiaUserProviderAdapterError(
      provider,
      409,
      'AI_PROVIDER_MODEL_UNAVAILABLE',
      'O modelo selecionado não está disponível nesta conta do provedor.'
    );
  }
  return new KyrubiaUserProviderAdapterError(
    provider,
    503,
    'AI_PROVIDER_UNAVAILABLE',
    'O provedor de IA está temporariamente indisponível.'
  );
};

const requestJson = async (
  provider: SupportedUserAiProvider,
  url: string,
  init: RequestInit
): Promise<Record<string, unknown>> => {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new KyrubiaUserProviderAdapterError(
      provider,
      503,
      'AI_PROVIDER_UNAVAILABLE',
      'Não foi possível alcançar o provedor de IA agora.'
    );
  }
  const payload = await safeJson(response);
  if (!response.ok) {
    console.warn('[Kyrubia BYO-AI] Provider request failed.', {
      provider,
      status: response.status,
    });
    throw providerFailure(provider, response.status);
  }
  return payload;
};

const geminiPart = (block: KyrubiaProviderContentBlock): Record<string, unknown> => {
  if (block.type === 'text') return { text: block.text };
  if (block.type === 'tool_call') {
    return {
      functionCall: {
        id: block.id,
        name: block.name,
        args: block.arguments,
      },
    };
  }
  return {
    functionResponse: {
      id: block.id,
      name: block.name,
      response: block.result,
    },
  };
};

const callGemini = async (
  input: KyrubiaProviderRequest
): Promise<KyrubiaProviderResponse> => {
  const tools = input.tools ?? [];
  const payload = await requestJson(
    'google-gemini',
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-goog-api-key': input.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.systemText }] },
        contents: input.turns.map(turn => ({
          role: turn.role === 'assistant' ? 'model' : 'user',
          parts: turn.content.map(geminiPart),
        })),
        ...(tools.length > 0
          ? {
              tools: [{ functionDeclarations: tools }],
              toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
            }
          : {}),
        generationConfig: {
          maxOutputTokens: normalizedMaxTokens(input.maxOutputTokens),
        },
      }),
      signal: input.signal,
    }
  );

  const candidate = asRecord(asArray(payload.candidates)[0]);
  const parts = asArray(asRecord(candidate.content).parts).map(asRecord);
  const text = parts
    .map(part => typeof part.text === 'string' ? part.text : '')
    .filter(Boolean)
    .join('\n')
    .trim();
  const toolCalls = parts.flatMap(part => {
    const call = asRecord(part.functionCall);
    const name = typeof call.name === 'string' ? call.name : '';
    if (!name) return [];
    return [{
      id: typeof call.id === 'string' && call.id ? call.id : `gemini-${name}`,
      name,
      arguments: parseArguments(call.args),
    }];
  });
  const usage = asRecord(payload.usageMetadata);
  return {
    provider: 'google-gemini',
    model: input.model,
    text,
    toolCalls,
    usage: {
      inputTokens: finiteToken(usage.promptTokenCount),
      outputTokens: finiteToken(usage.candidatesTokenCount),
      totalTokens: finiteToken(usage.totalTokenCount),
    },
  };
};

const openAiInputItems = (
  turns: KyrubiaProviderTurn[]
): Array<Record<string, unknown>> =>
  turns.flatMap(turn => turn.content.map(block => {
    if (block.type === 'text') {
      return {
        role: turn.role,
        content: block.text,
      };
    }
    if (block.type === 'tool_call') {
      return {
        type: 'function_call',
        call_id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.arguments),
      };
    }
    return {
      type: 'function_call_output',
      call_id: block.id,
      output: JSON.stringify(block.result),
    };
  }));

const callOpenAi = async (
  input: KyrubiaProviderRequest
): Promise<KyrubiaProviderResponse> => {
  const tools = input.tools ?? [];
  const payload = await requestJson('openai', 'https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      instructions: input.systemText,
      input: openAiInputItems(input.turns),
      ...(tools.length > 0
        ? {
            tools: tools.map(tool => ({
              type: 'function',
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
              strict: false,
            })),
            tool_choice: 'auto',
          }
        : {}),
      max_output_tokens: normalizedMaxTokens(input.maxOutputTokens),
    }),
    signal: input.signal,
  });

  const output = asArray(payload.output).map(asRecord);
  const text = output.flatMap(item =>
    item.type === 'message'
      ? asArray(item.content).map(asRecord)
          .filter(content => content.type === 'output_text')
          .map(content => typeof content.text === 'string' ? content.text : '')
      : []
  ).filter(Boolean).join('\n').trim();
  const toolCalls = output.flatMap(item => {
    if (item.type !== 'function_call') return [];
    const name = typeof item.name === 'string' ? item.name : '';
    if (!name) return [];
    const id = typeof item.call_id === 'string' && item.call_id
      ? item.call_id
      : typeof item.id === 'string' && item.id
        ? item.id
        : `openai-${name}`;
    return [{
      id,
      name,
      arguments: parseArguments(item.arguments),
    }];
  });
  const usage = asRecord(payload.usage);
  return {
    provider: 'openai',
    model: typeof payload.model === 'string' ? payload.model : input.model,
    text,
    toolCalls,
    usage: {
      inputTokens: finiteToken(usage.input_tokens),
      outputTokens: finiteToken(usage.output_tokens),
      totalTokens: finiteToken(usage.total_tokens),
    },
  };
};

const anthropicContent = (
  block: KyrubiaProviderContentBlock
): Record<string, unknown> => {
  if (block.type === 'text') return { type: 'text', text: block.text };
  if (block.type === 'tool_call') {
    return {
      type: 'tool_use',
      id: block.id,
      name: block.name,
      input: block.arguments,
    };
  }
  return {
    type: 'tool_result',
    tool_use_id: block.id,
    content: JSON.stringify(block.result),
  };
};

const callAnthropic = async (
  input: KyrubiaProviderRequest
): Promise<KyrubiaProviderResponse> => {
  const tools = input.tools ?? [];
  const payload = await requestJson('anthropic', 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-api-key': input.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: input.model,
      system: input.systemText,
      max_tokens: normalizedMaxTokens(input.maxOutputTokens),
      messages: input.turns.map(turn => ({
        role: turn.role,
        content: turn.content.map(anthropicContent),
      })),
      ...(tools.length > 0
        ? {
            tools: tools.map(tool => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters,
            })),
            tool_choice: { type: 'auto' },
          }
        : {}),
    }),
    signal: input.signal,
  });

  const content = asArray(payload.content).map(asRecord);
  const text = content
    .filter(block => block.type === 'text')
    .map(block => typeof block.text === 'string' ? block.text : '')
    .filter(Boolean)
    .join('\n')
    .trim();
  const toolCalls = content.flatMap(block => {
    if (block.type !== 'tool_use') return [];
    const name = typeof block.name === 'string' ? block.name : '';
    if (!name) return [];
    return [{
      id: typeof block.id === 'string' && block.id ? block.id : `anthropic-${name}`,
      name,
      arguments: parseArguments(block.input),
    }];
  });
  const usage = asRecord(payload.usage);
  const inputTokens = finiteToken(usage.input_tokens);
  const outputTokens = finiteToken(usage.output_tokens);
  return {
    provider: 'anthropic',
    model: typeof payload.model === 'string' ? payload.model : input.model,
    text,
    toolCalls,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens:
        inputTokens !== undefined && outputTokens !== undefined
          ? inputTokens + outputTokens
          : undefined,
    },
  };
};

export const callKyrubiaUserProvider = async (
  input: KyrubiaProviderRequest
): Promise<KyrubiaProviderResponse> => {
  if (input.provider === 'google-gemini') return callGemini(input);
  if (input.provider === 'openai') return callOpenAi(input);
  return callAnthropic(input);
};
