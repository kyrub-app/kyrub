import type { KyrubErpContextSnapshot } from '../../shared/kyrubErpContext';
import type {
  KyrubAiUpdateProductProposal,
  KyrubProductPatch,
} from '../../shared/kyrubActions';

export type KyrubiaDeterministicProductUpdateResolution = {
  reply: string;
  actionProposal?: KyrubAiUpdateProductProposal;
};

type ProductUpdateIntent = {
  currentName: string;
  field: keyof KyrubProductPatch;
  value: string | number;
};

export type ProductNameUpdateIntent = {
  currentName: string;
  nextName: string;
};

const createRequestId = (): string => {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `kyrub-product-update-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const stripOuterQuotes = (value: string): string =>
  value
    .trim()
    .replace(/^["“”']+/, '')
    .replace(/["“”']+$/, '')
    .trim();

const parseMoney = (value: string): number | null => {
  const cleaned = value
    .replace(/R\$/gi, '')
    .replace(/\s+/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const updateVerb = '(?:altere|alterar|mude|mudar|troque|trocar|renomeie|renomear|atualize|atualizar)';
const productKind = '(?:produto|item|servi[cç]o)';

export const parseKyrubiaProductNameUpdate = (
  message: string
): ProductNameUpdateIntent | null => {
  const intent = message.trim();
  if (!intent) return null;

  const quoted = new RegExp(`\\b${updateVerb}\\s+(?:o\\s+)?nome\\s+(?:do|da)\\s+${productKind}\\s+["“]([^"”]+)["”]\\s+para\\s+["“]?(.+?)["”]?\\s*$`, 'i').exec(intent);
  const fallback = new RegExp(`\\b${updateVerb}\\s+(?:o\\s+)?nome\\s+(?:do|da)\\s+${productKind}\\s+(.+?)\\s+para\\s+(.+?)\\s*$`, 'i').exec(intent);
  const match = quoted ?? fallback;
  if (!match?.[1] || !match[2]) return null;

  const currentName = stripOuterQuotes(match[1]);
  const nextName = stripOuterQuotes(match[2]);
  if (!currentName || !nextName) return null;
  if (currentName.length > 160 || nextName.length > 160) return null;

  return { currentName, nextName };
};

const parseFieldUpdate = (message: string): ProductUpdateIntent | null => {
  const intent = message.trim();
  if (!intent) return null;
  const match = new RegExp(
    `\\b${updateVerb}\\s+(?:o|a)?\\s*(pre[cç]o|categoria|descri[cç][aã]o|imagem)\\s+(?:do|da)\\s+${productKind}\\s+(?:["“]([^"”]+)["”]|(.+?))\\s+para\\s+(.+?)\\s*$`,
    'i'
  ).exec(intent);
  if (!match) return null;

  const currentName = stripOuterQuotes(match[2] || match[3] || '');
  const rawValue = stripOuterQuotes(match[4] || '');
  if (!currentName || !rawValue || currentName.length > 160) return null;

  const fieldLabel = normalize(match[1] || '');
  if (fieldLabel === 'preco') {
    const price = parseMoney(rawValue);
    return price === null ? null : { currentName, field: 'price', value: price };
  }
  if (fieldLabel === 'categoria') {
    return rawValue.length <= 120
      ? { currentName, field: 'category', value: rawValue }
      : null;
  }
  if (fieldLabel === 'descricao') {
    return rawValue.length <= 2_000
      ? { currentName, field: 'description', value: rawValue }
      : null;
  }
  if (fieldLabel === 'imagem') {
    return rawValue.length <= 2_000
      ? { currentName, field: 'image', value: rawValue }
      : null;
  }
  return null;
};

export const parseKyrubiaProductUpdate = (
  message: string
): ProductUpdateIntent | null => {
  const rename = parseKyrubiaProductNameUpdate(message);
  if (rename) {
    return { currentName: rename.currentName, field: 'name', value: rename.nextName };
  }
  return parseFieldUpdate(message);
};

export const isKyrubiaDeterministicProductUpdateIntent = (
  message: string
): boolean => parseKyrubiaProductUpdate(message) !== null;

const describeValue = (field: keyof KyrubProductPatch, value: string | number): string => {
  if (field === 'price' && typeof value === 'number') {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  }
  return `“${String(value)}”`;
};

const fieldLabel = (field: keyof KyrubProductPatch): string => ({
  name: 'nome',
  description: 'descrição',
  price: 'preço',
  category: 'categoria',
  image: 'imagem',
}[field]);

export const resolveKyrubiaDeterministicProductUpdate = (
  message: string,
  context?: KyrubErpContextSnapshot
): KyrubiaDeterministicProductUpdateResolution | null => {
  const intent = parseKyrubiaProductUpdate(message);
  if (!intent) return null;

  if (!context || context.availability.products !== true) {
    return {
      reply:
        'Entendi que você quer alterar um produto, mas não consegui confirmar o catálogo da sua loja nesta leitura. Nenhuma alteração foi proposta para evitar editar o item errado.',
    };
  }

  const expectedName = normalize(intent.currentName);
  const matches = context.products.filter(
    product => normalize(product.name) === expectedName
  );

  if (matches.length === 0) {
    return {
      reply: context.productsTruncated
        ? `Não encontrei “${intent.currentName}” na parte do catálogo disponível nesta leitura. Como a lista está parcial, não vou adivinhar qual item alterar.`
        : `Não encontrei um produto chamado “${intent.currentName}” na sua loja. Nenhuma alteração foi proposta.`,
    };
  }

  if (matches.length > 1) {
    return {
      reply:
        `Encontrei mais de um item chamado “${intent.currentName}”. Não vou escolher um deles por suposição. Identifique o item de forma mais específica.`,
    };
  }

  const product = matches[0];
  if (
    (intent.field === 'name' && normalize(product.name) === normalize(String(intent.value))) ||
    (intent.field === 'price' && product.price === intent.value) ||
    (intent.field === 'category' && normalize(product.category) === normalize(String(intent.value)))
  ) {
    return {
      reply: `O ${fieldLabel(intent.field)} de “${product.name}” já está com esse valor. Nenhuma alteração é necessária.`,
    };
  }

  const patch: KyrubProductPatch = { [intent.field]: intent.value } as KyrubProductPatch;
  const actionProposal: KyrubAiUpdateProductProposal = {
    id: createRequestId(),
    type: 'update_product',
    productId: product.id,
    expectedCurrentName: product.name,
    patch,
    requiresConfirmation: true,
    origin: 'kyrubia',
    risk: 'medium',
    inputProvenance: 'user_intent',
    impact: { entityCount: 1, reversibility: 'limited' },
  };

  return {
    reply:
      `Encontrei o produto “${product.name}”. Vou alterar somente ${fieldLabel(intent.field)} para ${describeValue(intent.field, intent.value)}. Revise e confirme antes de eu salvar essa mudança no catálogo da sua loja.`,
    actionProposal,
  };
};
