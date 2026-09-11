import { randomUUID } from 'node:crypto';
import type { AuthenticatedConsultantUser } from '../ai/types.js';
import { buildKyrubiaSystemInstruction } from '../ai/kyrubiaSystemInstruction.js';
import {
  runKyrubiaUserProviderText,
  type KyrubiaTextRuntimeMessage,
} from '../ai/kyrubiaUserProviderRuntime.js';
import type { KyrubMcpPrincipal } from './kyrubiaMcpAuth.js';
import { callKyrubMcpReadTool } from './kyrubiaMcpReadService.js';

const MAX_MESSAGE = 4_000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_TOTAL = 12_000;

const clean = (value: unknown, maximum: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maximum) : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const normalizeHistory = (value: unknown): KyrubiaTextRuntimeMessage[] => {
  if (!Array.isArray(value)) return [];
  let remaining = MAX_HISTORY_TOTAL;
  const result: KyrubiaTextRuntimeMessage[] = [];
  for (const candidate of value.slice(-MAX_HISTORY_MESSAGES)) {
    const item = record(candidate);
    const role = item.role === 'assistant' ? 'assistant' : item.role === 'user' ? 'user' : null;
    if (!role || remaining <= 0) continue;
    const content = clean(item.content, Math.min(MAX_MESSAGE, remaining));
    if (!content) continue;
    result.push({ role, content });
    remaining -= content.length;
  }
  return result;
};

const loadReadOnlySnapshot = async (principal: KyrubMcpPrincipal): Promise<Record<string, unknown>> => {
  const [store, products, inventory, orders] = await Promise.all([
    callKyrubMcpReadTool(principal, 'kyrub_get_store', {}),
    callKyrubMcpReadTool(principal, 'kyrub_list_products', { limit: 40 }),
    callKyrubMcpReadTool(principal, 'kyrub_get_inventory', { limit: 40 }),
    callKyrubMcpReadTool(principal, 'kyrub_list_pending_orders', { limit: 15 }),
  ]);
  return { store, products, inventory, pendingOrders: orders };
};

const bridgeInstruction = (snapshot: Record<string, unknown>): string => `

PONTE EXTERNA KYRUBIA — MODO PROPOSAL_ONLY
- Esta conversa chegou por uma integração externa autenticada e revogável.
- Você pode analisar e conversar usando somente o snapshot autoritativo de leitura fornecido abaixo.
- Você NÃO possui ferramenta de mutação nesta chamada. Não afirme que criou, renomeou, editou, publicou, excluiu, confirmou ou salvou algo.
- Quando o usuário solicitar uma alteração, explique com precisão a ação que deveria ser preparada e diga que a execução precisa voltar ao fluxo autenticado/confirmado do Kyrub.
- Não invente dados ausentes no snapshot. Se precisar de informação atual que não esteja aqui, diga que a ponte v0 ainda não a expõe.
- Nunca peça, revele ou repita tokens, chaves, segredos ou credenciais da integração.

SNAPSHOT KYRUB SOMENTE LEITURA
${JSON.stringify(snapshot)}
`;

export type KyrubiaMcpChatResult = {
  conversationId: string;
  requestId: string;
  mode: 'proposal_only';
  status: 'ok' | 'provider_selection_required' | 'provider_unavailable';
  reply: string;
  provider?: 'google-gemini' | 'openai' | 'anthropic';
  model?: string;
  availableProviders?: Array<'google-gemini' | 'openai' | 'anthropic'>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  execution: {
    writesAllowed: false;
    providerWritesAllowed: false;
    requiresKyrubConfirmation: true;
  };
};

export const callKyrubiaMcpChat = async (
  principal: KyrubMcpPrincipal,
  args: Record<string, unknown>
): Promise<KyrubiaMcpChatResult> => {
  const message = clean(args.message, MAX_MESSAGE);
  if (!message) throw new Error('KYRUBIA_BRIDGE_MESSAGE_REQUIRED');
  const conversationId = clean(args.conversationId, 180) || `bridge-${randomUUID()}`;
  const topic = clean(args.topic, 80) || 'Conversa via ponte externa';
  const history = normalizeHistory(args.history);
  const snapshot = await loadReadOnlySnapshot(principal);
  const user: AuthenticatedConsultantUser = {
    uid: principal.uid,
    email: principal.email ?? '',
    name: principal.name || 'Usuário do Kyrub',
  };
  const systemText = `${buildKyrubiaSystemInstruction(user, topic, 'Ponte externa autenticada do Kyrub')}${bridgeInstruction(snapshot)}`;
  const requestId = randomUUID();
  const result = await runKyrubiaUserProviderText({
    uid: principal.uid,
    systemText,
    messages: [...history, { role: 'user', content: message }],
    tools: [],
    hasAttachments: false,
  });
  const execution = {
    writesAllowed: false as const,
    providerWritesAllowed: false as const,
    requiresKyrubConfirmation: true as const,
  };

  if (result.status === 'selection_required') {
    return {
      conversationId,
      requestId,
      mode: 'proposal_only',
      status: 'provider_selection_required',
      reply: 'Escolha sua IA preferida em “Minha IA” no Kyrub antes de continuar pela ponte externa.',
      availableProviders: result.availableProviders,
      execution,
    };
  }
  if (result.status === 'legacy_allowed') {
    return {
      conversationId,
      requestId,
      mode: 'proposal_only',
      status: 'provider_unavailable',
      reply: 'A ponte externa exige uma IA do usuário configurada no Kyrub antes de conversar com a Kyrubia.',
      execution,
    };
  }
  if (result.status === 'provider_failed') {
    return {
      conversationId,
      requestId,
      mode: 'proposal_only',
      status: 'provider_unavailable',
      reply: result.message,
      provider: result.provider,
      execution,
    };
  }

  return {
    conversationId,
    requestId,
    mode: 'proposal_only',
    status: 'ok',
    reply: result.response.text.trim() || 'A Kyrubia não retornou texto nesta chamada.',
    provider: result.provider,
    model: result.model,
    usage: result.response.usage,
    execution,
  };
};
