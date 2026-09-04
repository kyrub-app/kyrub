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
  KYRUBIA_QUERY_PRODUCTS_TOOL_NAME,
  type KyrubiaCreateNoteProposal,
  type KyrubiaNormalizedToolCall,
} from './kyrubiaSharedToolExecutor.js';
import { prepareKyrubiaMercadoLivrePublication } from './kyrubiaMercadoLivrePrepareTool.js';
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

const KYRUBIA_PREPARE_MERCADO_LIVRE_PUBLICATION_TOOL_NAME =
  'prepare_mercado_livre_publication';

const KYRUBIA_PREPARE_MERCADO_LIVRE_PUBLICATION_DECLARATION = {
  name: KYRUBIA_PREPARE_MERCADO_LIVRE_PUBLICATION_TOOL_NAME,
  description:
    'Prepara somente um rascunho interno de publicação no Mercado Livre para um produto real retornado por query_products nesta mesma interação. Não publica, não cria autorização de publicação e não pode usar um productId inventado.',
  parameters: {
    type: 'OBJECT',
    properties: {
      productId: {
        type: 'STRING',
        description:
          'ID exato de um produto retornado por query_products nesta mesma interação.',
      },
    },
    required: ['productId'],
  },
} as const;

const declarations = (
  source: typeof KYRUBIA_ALL_TOOLS | typeof KYRUBIA_MUTATION_TOOL
) => source.functionDeclarations.map(declaration => ({
  name: declaration.name,
  description: declaration.description,
  parameters: declaration.parameters as unknown as Record<string, unknown>,
}));

const postReadDeclarations = () => [
  ...declarations(KYRUBIA_MUTATION_TOOL),
  {
    name: KYRUBIA_PREPARE_MERCADO_LIVRE_PUBLICATION_DECLARATION.name,
    description: KYRUBIA_PREPARE_MERCADO_LIVRE_PUBLICATION_DECLARATION.description,
    parameters: KYRUBIA_PREPARE_MERCADO_LIVRE_PUBLICATION_DECLARATION.parameters as unknown as Record<string, unknown>,
  },
];

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

const cleanProductId = (value: unknown): string =>
  typeof value === 'string' ? value.trim().slice(0, 160) : '';

const productIdsFromReadResult = (readResult: Record<string, unknown>): Set<string> => {
  if (!Array.isArray(readResult.items)) return new Set<string>();
  return new Set(readResult.items.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const id = cleanProductId((item as Record<string, unknown>).id);
    return id ? [id] : [];
  }));
};

const mercadoLivreCategoryStepReply = (
  result: Extract<
    Awaited<ReturnType<typeof prepareKyrubiaMercadoLivrePublication>>,
    { prepared: true }
  >
): string => {
  const inspection = result.requirementInspection;
  if (inspection.status === 'unavailable') return inspection.message;
  if (inspection.categorySuggestions.length === 0) {
    return 'O Mercado Livre não retornou uma categoria sugerida para este produto. Precisamos revisar a classificação antes de continuar.';
  }
  const suggestions = inspection.categorySuggestions
    .map((suggestion, index) => `${index + 1}) ${suggestion.categoryName}`)
    .join('; ');
  return `O Mercado Livre sugeriu estas categorias: ${suggestions}. Escolha a categoria correta antes de continuarmos. Depois dela, o Kyrub consultará as opções oficiais de condição, tipo de anúncio e atributos obrigatórios.`;
};

const mercadoLivrePrepareReply = (
  result: Awaited<ReturnType<typeof prepareKyrubiaMercadoLivrePublication>>
): string => {
  if ('message' in result) return result.message;
  const model = result.providerPublicationModel === 'user_products'
    ? 'User Products'
    : 'itens legado';
  return [
    `Encontrei o produto real no catálogo e preparei o rascunho interno para o Mercado Livre usando o modelo ${model}.`,
    mercadoLivreCategoryStepReply(result),
    'Nenhuma publicação foi enviada ao Mercado Livre e nenhuma autorização de publicação foi criada.',
  ].join(' ');
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
    tools: postReadDeclarations(),
    hasAttachments: false,
    signal: input.signal,
  });

  if (second.status !== 'user_provider') return second;

  const supportedSecondCalls = second.response.toolCalls.filter(call =>
    call.name === 'create_note' ||
    call.name === KYRUBIA_PREPARE_MERCADO_LIVRE_PUBLICATION_TOOL_NAME
  );
  if (supportedSecondCalls.length !== second.response.toolCalls.length || supportedSecondCalls.length > 1) {
    return {
      status: 'provider_failed',
      provider: second.provider,
      code: 'AI_PROVIDER_UNSUPPORTED_TOOL',
      message: 'A IA conectada solicitou uma combinação de ferramentas que o Kyrub não permite executar.',
    };
  }

  const mercadoLivreCall = supportedSecondCalls.find(
    call => call.name === KYRUBIA_PREPARE_MERCADO_LIVRE_PUBLICATION_TOOL_NAME
  );
  if (mercadoLivreCall) {
    const requestedProductId = cleanProductId(mercadoLivreCall.arguments.productId);
    const observedProductIds = productIdsFromReadResult(readResult);
    if (
      readCall.name !== KYRUBIA_QUERY_PRODUCTS_TOOL_NAME ||
      !requestedProductId ||
      requestedProductId.includes('/') ||
      !observedProductIds.has(requestedProductId)
    ) {
      return {
        status: 'provider_failed',
        provider: second.provider,
        code: 'AI_PROVIDER_UNSUPPORTED_TOOL',
        message: 'A IA tentou preparar uma publicação para um produto que não foi confirmado pela consulta atual do catálogo.',
      };
    }

    const prepared = await prepareKyrubiaMercadoLivrePublication({
      uid: input.uid,
      productId: requestedProductId,
    });
    return {
      status: 'user_provider',
      provider: second.provider,
      model: second.model,
      reply: mercadoLivrePrepareReply(prepared),
      usage: addUsage(first.response.usage, second.response.usage),
      calls: 2,
    };
  }

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
