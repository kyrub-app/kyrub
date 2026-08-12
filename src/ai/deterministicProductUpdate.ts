import type { KyrubErpContextSnapshot } from '../../shared/kyrubErpContext';
import type { KyrubAiUpdateProductProposal } from '../../shared/kyrubActions';

export type KyrubiaDeterministicProductUpdateResolution = {
  reply: string;
  actionProposal?: KyrubAiUpdateProductProposal;
};

type ProductNameUpdateIntent = {
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

export const parseKyrubiaProductNameUpdate = (
  message: string
): ProductNameUpdateIntent | null => {
  const intent = message.trim();
  if (!intent) return null;

  const quoted = /\b(?:altere|alterar|mude|mudar|troque|trocar|renomeie|renomear|atualize|atualizar)\s+(?:o\s+)?nome\s+(?:do|da)\s+(?:produto|item|servi[cç]o)\s+["“]([^"”]+)["”]\s+para\s+["“]?(.+?)["”]?\s*$/i.exec(intent);
  const fallback = /\b(?:altere|alterar|mude|mudar|troque|trocar|renomeie|renomear|atualize|atualizar)\s+(?:o\s+)?nome\s+(?:do|da)\s+(?:produto|item|servi[cç]o)\s+(.+?)\s+para\s+(.+?)\s*$/i.exec(intent);
  const match = quoted ?? fallback;
  if (!match?.[1] || !match[2]) return null;

  const currentName = stripOuterQuotes(match[1]);
  const nextName = stripOuterQuotes(match[2]);
  if (!currentName || !nextName) return null;
  if (currentName.length > 160 || nextName.length > 160) return null;

  return { currentName, nextName };
};

export const isKyrubiaDeterministicProductUpdateIntent = (
  message: string
): boolean => parseKyrubiaProductNameUpdate(message) !== null;

export const resolveKyrubiaDeterministicProductUpdate = (
  message: string,
  context?: KyrubErpContextSnapshot
): KyrubiaDeterministicProductUpdateResolution | null => {
  const intent = parseKyrubiaProductNameUpdate(message);
  if (!intent) return null;

  if (!context || context.availability.products !== true) {
    return {
      reply:
        'Entendi que você quer alterar o nome de um produto, mas não consegui confirmar o catálogo da sua loja nesta leitura. Nenhuma alteração foi proposta para evitar editar o item errado.',
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
        `Encontrei mais de um item chamado “${intent.currentName}”. Não vou escolher um deles por suposição. Faça a alteração manualmente no ERP por enquanto ou identifique o item de forma mais específica.`,
    };
  }

  const product = matches[0];
  if (normalize(product.name) === normalize(intent.nextName)) {
    return {
      reply: `O produto “${product.name}” já está com esse nome. Nenhuma alteração é necessária.`,
    };
  }

  const actionProposal: KyrubAiUpdateProductProposal = {
    id: createRequestId(),
    type: 'update_product',
    productId: product.id,
    expectedCurrentName: product.name,
    patch: { name: intent.nextName },
    requiresConfirmation: true,
    origin: 'kyrubia',
    risk: 'medium',
    inputProvenance: 'user_intent',
    impact: { entityCount: 1, reversibility: 'limited' },
  };

  return {
    reply:
      `Encontrei o produto “${product.name}”. Vou alterar somente o nome para “${intent.nextName}”. Revise e confirme antes de eu salvar essa mudança no catálogo da sua loja.`,
    actionProposal,
  };
};
