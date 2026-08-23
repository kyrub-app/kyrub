import type { KyrubErpContextSnapshot } from '../../shared/kyrubErpContext.js';
import type {
  KyrubiaProviderTurn,
  KyrubiaProviderUsage,
} from './kyrubiaUserProviderAdapters.js';
import {
  executeKyrubiaSharedReadTool,
  isKyrubiaErpReadTool,
  kyrubiaCreateNoteProposalFromCall,
  KYRUBIA_ALL_TOOLS,
  KYRUBIA_MUTATION_TOOL,
  type KyrubiaCreateNoteProposal,
  type KyrubiaNormalizedToolCall,
} from './kyrubiaSharedToolExecutor.js';
import {
  messagesToKyrubiaProviderTurns,
  runKyrubiaUserProviderText,
  type KyrubiaTextRuntimeMessage,
  type KyrubiaUserProviderRuntimeResult,
} from './kyrubiaUserProviderRuntime.js';
import type { SupportedUserAiProvider } from './userAiProviderCredentialService.js';

export type KyrubiaUserProviderToolLoopResult =
  | {
      status: 'user_provider';
      provider: SupportedUserAiProvider;
      model: string;
      reply: string;
      actionProposal?: KyrubiaCreateNoteProposal;
      usage: KyrubiaProviderUsage;
      calls: 1 | 2;
    }
  | Exclude<KyrubiaUserProviderRuntimeResult, { status: 'user_provider' }>;

const declarations = (
  source: typeof KYRUBIA_ALL_TOOLS | typeof KYRUBIA_MUTATION_TOOL
) => source.functionDeclarations.map(declaration => ({
  name: declaration.name,
  description: declaration.description,
  parameters: declaration.parameters as unknown as Record<string, unknown>,
}));

const normalizedToolCall = (call: {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}): KyrubiaNormalizedToolCall => ({
  id: call.id,
  name: call.name,
  args: call.arguments,
});

const addUsage = (
  first: KyrubiaProviderUsage,
  second?: KyrubiaProviderUsage
): KyrubiaProviderUsage => {
  const total = (key: keyof KyrubiaProviderUsage): number | undefined => {
    const values = [first[key], second?.[key]].filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value)
    );
    return values.length ? values.reduce((sum, value) => sum + value, 0) : undefined;
  };
  return {
    ...(total('inputTokens') !== undefined ? { inputTokens: total('inputTokens') } : {}),
    ...(total('outputTokens') !== undefined ? { outputTokens: total('outputTokens') } : {}),
    ...(total('totalTokens') !== undefined ? { totalTokens: total('totalTokens') } : {}),
  };
};

const noteProposal = (
  calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
): KyrubiaCreateNoteProposal | undefined => {
  const note = calls.find(call => call.name === 'create_note');
  return note ? kyrubiaCreateNoteProposalFromCall(normalizedToolCall(note)) : undefined;
};

const firstReadCall = (
  calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
) => calls.find(call => isKyrubiaErpReadTool(call.name));

const turnsWithReadResult = (
  messages: KyrubiaTextRuntimeMessage[],
  response: {
    text: string;
    toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  },
  readCall: { id: string; name: string; arguments: Record<string, unknown> },
  readResult: Record<string, unknown>
): KyrubiaProviderTurn[] => {
  const turns = messagesToKyrubiaProviderTurns(messages);
  const assistantContent: KyrubiaProviderTurn['content'] = [];
  if (response.text.trim()) {
    assistantContent.push({ type: 'text', text: response.text.trim() });
  }
  for (const call of response.toolCalls) {
    assistantContent.push({
      type: 'tool_call',
      id: call.id,
      name: call.name,
      arguments: call.arguments,
    });
  }
  turns.push({ role: 'assistant', content: assistantContent });
  turns.push({
    role: 'user',
    content: [{
      type: 'tool_result',
      id: readCall.id,
      name: readCall.name,
      result: readResult,
    }],
  });
  return turns;
};

export const runKyrubiaUserProviderToolLoop = async (input: {
  uid: string;
  systemText: string;
  messages: KyrubiaTextRuntimeMessage[];
  erpContext: KyrubErpContextSnapshot | null;
  hasAttachments: boolean;
  signal?: AbortSignal;
}): Promise<KyrubiaUserProviderToolLoopResult> => {
  const first = await runKyrubiaUserProviderText({
    uid: input.uid,
    systemText: input.systemText,
    messages: input.messages,
    tools: declarations(KYRUBIA_ALL_TOOLS),
    hasAttachments: input.hasAttachments,
    signal: input.signal,
  });

  if (first.status !== 'user_provider') return first;

  const firstProposal = noteProposal(first.response.toolCalls);
  if (firstProposal) {
    return {
      status: 'user_provider',
      provider: first.provider,
      model: first.model,
      reply: first.response.text.trim() ||
        `Preparei a nota “${firstProposal.title}”. Revise o conteúdo e confirme para adicioná-la às suas notas.`,
      actionProposal: firstProposal,
      usage: first.response.usage,
      calls: 1,
    };
  }

  const readCall = firstReadCall(first.response.toolCalls);
  if (!readCall) {
    if (first.response.toolCalls.length > 0 && !first.response.text.trim()) {
      return {
        status: 'provider_failed',
        provider: first.provider,
        code: 'AI_PROVIDER_UNSUPPORTED_TOOL',
        message: 'A IA conectada solicitou uma ferramenta que o Kyrub não permite executar.',
      };
    }
    return {
      status: 'user_provider',
      provider: first.provider,
      model: first.model,
      reply: first.response.text.trim(),
      usage: first.response.usage,
      calls: 1,
    };
  }

  const readResult = executeKyrubiaSharedReadTool(
    normalizedToolCall(readCall),
    input.erpContext
  );
  const turns = turnsWithReadResult(
    input.messages,
    first.response,
    readCall,
    readResult
  );

  const second = await runKyrubiaUserProviderText({
    uid: input.uid,
    systemText: input.systemText,
    messages: input.messages,
    turns,
    tools: declarations(KYRUBIA_MUTATION_TOOL),
    hasAttachments: false,
    signal: input.signal,
  });

  if (second.status !== 'user_provider') return second;

  const secondProposal = noteProposal(second.response.toolCalls);
  const reply = second.response.text.trim();
  if (!reply && !secondProposal) {
    return {
      status: 'provider_failed',
      provider: second.provider,
      code: 'AI_PROVIDER_EMPTY_RESPONSE',
      message: 'A IA conectada não conseguiu concluir a resposta após consultar o ERP.',
    };
  }

  return {
    status: 'user_provider',
    provider: second.provider,
    model: second.model,
    reply: reply ||
      `Preparei a nota “${secondProposal?.title ?? 'solicitada'}”. Revise o conteúdo e confirme para adicioná-la às suas notas.`,
    ...(secondProposal ? { actionProposal: secondProposal } : {}),
    usage: addUsage(first.response.usage, second.response.usage),
    calls: 2,
  };
};
