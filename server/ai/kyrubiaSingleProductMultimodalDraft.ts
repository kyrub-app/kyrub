import type {
  KyrubAiConsultantResponse,
  KyrubAiConversationMessage,
} from '../../shared/aiConsultant.js';
import type { KyrubAiCreateProductProposal } from '../../shared/kyrubActions.js';
import { classifyKyrubiaCapability } from '../../shared/kyrubiaCapabilityRouter.js';

type ProductDraft = {
  name?: string;
  description?: string;
  price?: number;
  stock?: number;
  category?: string;
  isService: boolean;
  isComplimentary: boolean;
};

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const clean = (value: string): string =>
  value
    .trim()
    .replace(/^["“”']+|["“”']+$/g, '')
    .trim();

const localizedNumber = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const parsePrice = (message: string): {
  price?: number;
  isComplimentary?: boolean;
} => {
  const intent = normalize(message);
  if (/\b(gratis|gratuito|gratuita|cortesia)\b/.test(intent)) {
    return { price: 0, isComplimentary: true };
  }
  const match =
    /r\$\s*(\d+(?:[.,]\d{1,2})?)/i.exec(message) ??
    /(?:pre[cç]o|valor)\s*(?:de|e|é|:)?\s*(\d+(?:[.,]\d{1,2})?)/i.exec(message) ??
    /(?:por|a)\s+(\d+(?:[.,]\d{1,2})?)\s*(?:reais)?\b/i.exec(message);
  const price = localizedNumber(match?.[1]);
  return price === undefined ? {} : { price, isComplimentary: false };
};

const parseStock = (message: string): number | undefined => {
  const intent = normalize(message);
  if (/\bsem estoque\b|\bestoque zerado\b/.test(intent)) return 0;
  const match =
    /estoque\s*(?:de|e|é|:)?\s*(\d+)\b/i.exec(message) ??
    /(?:com|tenho)\s+(\d+)\s+unidades?\b/i.exec(message) ??
    /\b(\d+)\s+unidades?\s+(?:em )?estoque\b/i.exec(message);
  const parsed = localizedNumber(match?.[1]);
  return parsed === undefined ? undefined : Math.trunc(parsed);
};

const parseCategory = (message: string): string | undefined => {
  const match = /categoria\s*(?:de|e|é|:)?\s*["“]?([^,.!?"”]+)["”]?/i.exec(message);
  const value = clean(match?.[1] ?? '');
  return value || undefined;
};

const parseProductName = (message: string): string | undefined => {
  const match = /\b(?:produto|item)\s+(?:(?:chamado|chamada|de nome)\s+)?["“]?([^,.!?"”]+?)["”]?(?=\s+(?:na minha|para minha|por\s+r\$|por\s+\d|a\s+r\$|pre[cç]o|valor|categoria|com\s+estoque|estoque|e depois|depois)|$)/i.exec(message);
  const value = clean(match?.[1] ?? '').replace(/^(?:um|uma)\s+/i, '').trim();
  if (!value || /^(?:novo|nova)$/i.test(value)) return undefined;
  return value;
};

const isExplicitSingleProductRequest = (message: string): boolean => {
  const intent = normalize(message);
  return Boolean(
    /\b(um unico produto|um so produto|mesmo produto|produto chamado|produto de nome)\b/.test(intent) ||
    (/\bproduto\b/.test(intent) && !/\b(produtos|itens|cardapio|catalogo|menu|lista)\b/.test(intent))
  );
};

const attachmentCount = (messages: KyrubAiConversationMessage[]): number =>
  messages.reduce(
    (total, message) => total + (message.role === 'user' ? message.attachments?.length ?? 0 : 0),
    0
  );

const lastSingleProductAnchor = (
  messages: KyrubAiConversationMessage[]
): number => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user') continue;
    if ((message.attachments?.length ?? 0) === 0) continue;
    if (classifyKyrubiaCapability(message.content).primary !== 'create_products') continue;
    if (!isExplicitSingleProductRequest(message.content)) continue;
    return index;
  }
  return -1;
};

const previousAssistant = (
  messages: KyrubAiConversationMessage[],
  userIndex: number
): string => {
  for (let index = userIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant') return message.content;
    if (message.role === 'user') return '';
  }
  return '';
};

const isCollectorPrompt = (message: string): boolean =>
  /pre[cç]o|categoria|estoque|quantas unidades/i.test(message);

const barePriceAnswer = (message: string, prompt: string): number | undefined => {
  if (!/pre[cç]o/i.test(prompt)) return undefined;
  return localizedNumber(/^\s*(?:r\$\s*)?(\d+(?:[.,]\d{1,2})?)\s*(?:reais)?\s*$/i.exec(message)?.[1]);
};

const bareStockAnswer = (message: string, prompt: string): number | undefined => {
  if (!/estoque|quantas unidades/i.test(prompt)) return undefined;
  const value = localizedNumber(/^\s*(\d+)\s*(?:unidades?)?\s*$/i.exec(message)?.[1]);
  return value === undefined ? undefined : Math.trunc(value);
};

const bareCategoryAnswer = (message: string, prompt: string): string | undefined => {
  if (!/categoria/i.test(prompt)) return undefined;
  if (message.length > 120 || /[!?]/.test(message)) return undefined;
  const value = clean(message.replace(/^categoria\s*[:=-]?\s*/i, ''));
  return value || undefined;
};

const draftFromConversation = (
  messages: KyrubAiConversationMessage[],
  anchorIndex: number
): ProductDraft => {
  const anchor = messages[anchorIndex];
  const anchorIntent = normalize(anchor.content);
  const initialPrice = parsePrice(anchor.content);
  const draft: ProductDraft = {
    ...(parseProductName(anchor.content) ? { name: parseProductName(anchor.content) } : {}),
    ...(initialPrice.price !== undefined ? { price: initialPrice.price } : {}),
    ...(initialPrice.isComplimentary !== undefined
      ? { isComplimentary: initialPrice.isComplimentary }
      : { isComplimentary: false }),
    ...(parseCategory(anchor.content) ? { category: parseCategory(anchor.content) } : {}),
    ...(parseStock(anchor.content) !== undefined ? { stock: parseStock(anchor.content) } : {}),
    isService: /\bservico\b/.test(anchorIntent) && !/\bproduto\b/.test(anchorIntent),
  };

  for (let index = anchorIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== 'user') continue;
    const prompt = previousAssistant(messages, index);
    if (!isCollectorPrompt(prompt)) continue;

    if (draft.price === undefined) {
      const explicit = parsePrice(message.content);
      const bare = barePriceAnswer(message.content, prompt);
      const price = explicit.price ?? bare;
      if (price !== undefined) {
        draft.price = price;
        draft.isComplimentary = explicit.isComplimentary === true;
        continue;
      }
    }

    if (!draft.category) {
      const category = parseCategory(message.content) ?? bareCategoryAnswer(message.content, prompt);
      if (category) {
        draft.category = category;
        continue;
      }
    }

    if (!draft.isService && draft.stock === undefined) {
      const stock = parseStock(message.content) ?? bareStockAnswer(message.content, prompt);
      if (stock !== undefined) draft.stock = stock;
    }
  }

  return draft;
};

const requestId = (): string => {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `kyrub-single-product-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

const response = (
  reply: string,
  actionProposal?: KyrubAiCreateProductProposal
): KyrubAiConsultantResponse => ({
  reply,
  provider: 'kyrub',
  model: 'kyrub-single-product-multimodal-runtime-v1',
  mode: 'deterministic',
  requestId: requestId(),
  ...(actionProposal ? { actionProposal } : {}),
  capabilities: {
    actionsEnabled: true,
    enabledActions: ['create_product'],
    enabledReadActions: [],
    voiceEnabled: false,
    persistentCloudHistoryEnabled: false,
    multimodalAttachmentsEnabled: true,
  },
});

const proposalFromDraft = (draft: ProductDraft): KyrubAiCreateProductProposal => ({
  id: requestId(),
  type: 'create_product',
  name: draft.name?.trim() ?? '',
  description: draft.description?.trim() ?? '',
  price: draft.isComplimentary ? 0 : draft.price ?? 0,
  stock: draft.isService ? 0 : draft.stock ?? 0,
  category: draft.category?.trim() ?? '',
  image: '',
  isService: draft.isService,
  isComplimentary: draft.isComplimentary,
  requiresConfirmation: true,
  origin: 'kyrubia',
  risk: 'medium',
  inputProvenance: 'user_intent',
  impact: { entityCount: 1, reversibility: 'limited' },
});

export const resolveKyrubiaSingleProductMultimodalDraft = (
  messages: KyrubAiConversationMessage[]
): KyrubAiConsultantResponse | null => {
  if (attachmentCount(messages) === 0) return null;
  const anchorIndex = lastSingleProductAnchor(messages);
  if (anchorIndex < 0) return null;

  const latestUserIndex = (() => {
    for (let index = messages.length - 1; index >= anchorIndex; index -= 1) {
      if (messages[index].role === 'user') return index;
    }
    return -1;
  })();
  if (latestUserIndex < anchorIndex) return null;

  const latestUser = messages[latestUserIndex];
  const latestDecision = classifyKyrubiaCapability(latestUser.content);
  if (
    latestUserIndex > anchorIndex &&
    latestDecision.primary !== 'conversation' &&
    latestDecision.primary !== 'create_products'
  ) {
    return null;
  }
  if (
    latestUserIndex > anchorIndex &&
    !isCollectorPrompt(previousAssistant(messages, latestUserIndex))
  ) {
    return null;
  }

  const draft = draftFromConversation(messages, anchorIndex);
  const referenceCount = attachmentCount(messages.slice(anchorIndex));
  const prefix = referenceCount > 0
    ? `Entendi que ${referenceCount === 1 ? 'o anexo é uma referência visual' : `os ${referenceCount} anexos são referências visuais`} do mesmo produto. Não vou transformá-los em itens separados nem inferir características comerciais que você não informou. `
    : '';

  if (!draft.name) {
    return response(prefix + 'Qual será o nome do produto?');
  }
  if (draft.price === undefined) {
    return response(prefix + `Qual será o preço de “${draft.name}”? Você também pode dizer “grátis”.`);
  }
  if (!draft.category) {
    return response(prefix + `Em qual categoria da sua Loja Kyrub “${draft.name}” deve ficar?`);
  }
  if (!draft.isService && draft.stock === undefined) {
    return response(prefix + `Quantas unidades de “${draft.name}” estão disponíveis agora? Se ainda não houver estoque, diga 0.`);
  }

  const proposal = proposalFromDraft(draft);
  return response(
    `O rascunho de “${proposal.name}” está completo para revisão: preço R$ ${proposal.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}, categoria “${proposal.category}”` +
      (proposal.isService ? '.' : ` e estoque ${proposal.stock}.`) +
      ' Os anexos continuam somente como referências visuais da conversa e não foram convertidos automaticamente em imagens comerciais do produto. Revise e confirme para criar o produto; nada será publicado no Mercado Livre nesta confirmação.',
    proposal
  );
};
