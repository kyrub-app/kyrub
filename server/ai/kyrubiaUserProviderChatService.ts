import { randomUUID } from 'node:crypto';
import type {
  KyrubErpContextSnapshot,
  KyrubErpOrderSummary,
  KyrubErpProductSummary,
  KyrubErpStoreSummary,
} from '../../shared/kyrubErpContext.js';
import { authenticateConsultantRequest } from './consultantAuth.js';
import { ConsultantHttpError } from './types.js';
import { buildKyrubiaSystemInstruction } from './kyrubiaSystemInstruction.js';
import { runKyrubiaUserProviderToolLoop } from './kyrubiaUserProviderToolLoop.js';

const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARACTERS = 4_000;
const MAX_TOTAL_CHARACTERS = 16_000;
const MAX_TOPIC_CHARACTERS = 80;
const MAX_SCREEN_CONTEXT_CHARACTERS = 240;
const MAX_ERP_PRODUCTS = 120;
const MAX_ERP_ORDERS = 30;

export type KyrubiaUserProviderChatBody =
  | {
      status: 'user_provider';
      reply: string;
      provider: 'google-gemini' | 'openai' | 'anthropic';
      model: string;
      mode: 'conversation';
      requestId: string;
      actionProposal?: {
        id: string;
        type: 'create_note';
        title: string;
        content: string;
        checklist: string[];
        requiresConfirmation: true;
      };
      funding: 'user_provider';
      usage: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      };
    }
  | {
      status: 'legacy_allowed';
      reason: 'no_user_provider' | 'multimodal_not_normalized';
      requestId: string;
    }
  | {
      status: 'selection_required';
      availableProviders: Array<'google-gemini' | 'openai' | 'anthropic'>;
      requestId: string;
      error: string;
      code: 'AI_PROVIDER_SELECTION_REQUIRED';
    }
  | {
      status: 'provider_failed';
      provider: 'google-gemini' | 'openai' | 'anthropic';
      requestId: string;
      error: string;
      code: string;
    };

export type KyrubiaUserProviderChatResult = {
  httpStatus: number;
  body: KyrubiaUserProviderChatBody;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const clean = (value: unknown, maximum: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : '';

const finite = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const nonNegativeInteger = (value: unknown, fallback = 0): number =>
  Math.max(0, Math.trunc(finite(value, fallback)));

const normalizeStore = (value: unknown): KyrubErpStoreSummary | null => {
  const raw = record(value);
  const id = clean(raw.id, 128);
  if (!id) return null;
  const plan = raw.plan === 'pro' || raw.plan === 'business' ? raw.plan : 'free';
  const status = raw.status === 'open' || raw.status === 'delayed' ? raw.status : 'closed';
  return {
    id,
    name: clean(raw.name, 160),
    description: clean(raw.description, 800),
    plan,
    status,
    address: clean(raw.address, 320),
    keywords: Array.isArray(raw.keywords)
      ? raw.keywords.map(item => clean(item, 80)).filter(Boolean).slice(0, 30)
      : [],
    configured: raw.configured === true,
  };
};

const normalizeProduct = (value: unknown): KyrubErpProductSummary | null => {
  const raw = record(value);
  const id = clean(raw.id, 160);
  const name = clean(raw.name, 180);
  const price = finite(raw.price, -1);
  const stock = finite(raw.stock, -1);
  if (!id || !name || price < 0 || stock < 0) return null;
  return {
    id,
    name,
    category: clean(raw.category, 120),
    price,
    stock: Math.trunc(stock),
    isService: raw.isService === true,
    hasDescription: raw.hasDescription === true,
    hasImage: raw.hasImage === true,
  };
};

const normalizeOrder = (value: unknown): KyrubErpOrderSummary | null => {
  const raw = record(value);
  const id = clean(raw.id, 180);
  const total = finite(raw.total, -1);
  if (!id || total < 0) return null;
  return {
    id,
    status: clean(raw.status, 80),
    paymentStatus: clean(raw.paymentStatus, 80),
    fulfillmentType: clean(raw.fulfillmentType, 80),
    total,
    itemCount: nonNegativeInteger(raw.itemCount),
    createdAt: clean(raw.createdAt, 80),
  };
};

const normalizeErpContext = (value: unknown): KyrubErpContextSnapshot | null => {
  const raw = record(value);
  if (raw.source !== 'authenticated_client_snapshot') return null;
  const availability = record(raw.availability);
  const products = Array.isArray(raw.products)
    ? raw.products.flatMap(item => {
        const product = normalizeProduct(item);
        return product ? [product] : [];
      }).slice(0, MAX_ERP_PRODUCTS)
    : [];
  const pendingOrders = Array.isArray(raw.pendingOrders)
    ? raw.pendingOrders.flatMap(item => {
        const order = normalizeOrder(item);
        return order ? [order] : [];
      }).slice(0, MAX_ERP_ORDERS)
    : [];
  return {
    source: 'authenticated_client_snapshot',
    generatedAt: clean(raw.generatedAt, 80),
    store: normalizeStore(raw.store),
    products,
    productCount: nonNegativeInteger(raw.productCount, products.length),
    productsTruncated: raw.productsTruncated === true,
    pendingOrders,
    pendingOrderCount: nonNegativeInteger(raw.pendingOrderCount, pendingOrders.length),
    ordersTruncated: raw.ordersTruncated === true,
    lowStockThreshold: Math.min(999_999, nonNegativeInteger(raw.lowStockThreshold, 5)),
    availability: {
      store: availability.store === true,
      products: availability.products === true,
      orders: availability.orders === true,
    },
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.map(item => clean(item, 180)).filter(Boolean).slice(0, 8)
      : [],
  };
};

const normalizeMessages = (value: unknown): {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  hasAttachments: boolean;
} => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConsultantHttpError(400, 'INVALID_REQUEST', 'Envie pelo menos uma mensagem para a Kyrubia.');
  }
  let hasAttachments = false;
  const messages = value.slice(-MAX_MESSAGES).flatMap(item => {
    const raw = record(item);
    const role = raw.role === 'assistant' ? 'assistant' as const : 'user' as const;
    const content = clean(raw.content, MAX_MESSAGE_CHARACTERS);
    if (role === 'user' && Array.isArray(raw.attachments) && raw.attachments.length > 0) {
      hasAttachments = true;
    }
    return content ? [{ role, content }] : [];
  });
  if (!messages.length || messages.at(-1)?.role !== 'user') {
    throw new ConsultantHttpError(400, 'INVALID_REQUEST', 'A solicitação precisa terminar com uma mensagem do usuário.');
  }
  const total = messages.reduce((sum, message) => sum + message.content.length, 0);
  if (total > MAX_TOTAL_CHARACTERS) {
    throw new ConsultantHttpError(400, 'INVALID_REQUEST', 'A conversa ficou muito longa para esta solicitação. Inicie um novo assunto.');
  }
  return { messages, hasAttachments };
};

export const executeAuthorizedKyrubiaUserProviderChat = async (
  authorization: string,
  input: unknown
): Promise<KyrubiaUserProviderChatResult> => {
  const user = await authenticateConsultantRequest(authorization);
  const requestId = randomUUID();
  const raw = record(input);
  const topic = clean(raw.topic, MAX_TOPIC_CHARACTERS) || 'Nova solicitação';
  const screenContext = clean(raw.screenContext, MAX_SCREEN_CONTEXT_CHARACTERS);
  const { messages, hasAttachments } = normalizeMessages(raw.messages);
  const erpContext = normalizeErpContext(raw.erpContext);

  const result = await runKyrubiaUserProviderToolLoop({
    uid: user.uid,
    systemText: buildKyrubiaSystemInstruction(user, topic, screenContext),
    messages,
    erpContext,
    hasAttachments,
  });

  if (result.status === 'legacy_allowed') {
    return {
      httpStatus: 200,
      body: { status: 'legacy_allowed', reason: result.reason, requestId },
    };
  }
  if (result.status === 'selection_required') {
    return {
      httpStatus: 409,
      body: {
        status: 'selection_required',
        availableProviders: result.availableProviders,
        requestId,
        error: 'Escolha sua IA preferida em “Minha IA” antes de continuar.',
        code: 'AI_PROVIDER_SELECTION_REQUIRED',
      },
    };
  }
  if (result.status === 'provider_failed') {
    return {
      httpStatus: result.code === 'AI_PROVIDER_CREDENTIAL_REJECTED' ? 400 : 503,
      body: {
        status: 'provider_failed',
        provider: result.provider,
        requestId,
        error: result.message,
        code: result.code,
      },
    };
  }

  return {
    httpStatus: 200,
    body: {
      status: 'user_provider',
      reply: result.reply,
      provider: result.provider,
      model: result.model,
      mode: 'conversation',
      requestId,
      ...(result.actionProposal ? { actionProposal: result.actionProposal } : {}),
      funding: 'user_provider',
      usage: result.usage,
    },
  };
};
