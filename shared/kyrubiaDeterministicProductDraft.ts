import type {
  KyrubCatalogDraftField,
  KyrubCatalogDraftFieldProvenance,
  KyrubCatalogDraftIssue,
  KyrubCatalogDraftProductInput,
} from './kyrubCatalogDrafts';

export type KyrubiaDeterministicProductDraft = {
  product: KyrubCatalogDraftProductInput;
  fieldProvenance: Partial<
    Record<KyrubCatalogDraftField, KyrubCatalogDraftFieldProvenance>
  >;
  issues: KyrubCatalogDraftIssue[];
};

const normalizeIntent = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const quotedProductName = (message: string): string => {
  const match = /(?:produto|item)\s+["“]([^"”]{1,120})["”]/i.exec(message);
  return match?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
};

const labelledQuotedText = (
  message: string,
  label: RegExp,
  maximum: number
): string | undefined => {
  const match = new RegExp(
    `${label.source}\\s*(?::|=|de)?\\s*["“]([^"”]{1,${maximum}})["”]`,
    'i'
  ).exec(message);
  const value = match?.[1]?.replace(/\s+/g, ' ').trim();
  return value || undefined;
};

const labelledPrice = (message: string): number | undefined => {
  const match = /pre[cç]o\s*(?::|=|de)?\s*(?:r\$\s*)?(\d{1,9}(?:\.\d{3})*(?:,\d{1,2})?|\d{1,9}(?:\.\d{1,2})?)/i.exec(message);
  if (!match?.[1]) return undefined;
  const raw = match[1];
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
};

const labelledStock = (message: string): number | undefined => {
  const match = /estoque\s*(?::|=|de)?\s*(\d{1,9})\b/i.exec(message);
  if (!match?.[1]) return undefined;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
};

export const isKyrubiaDeterministicProductDraftIntent = (
  message: string
): boolean => {
  const intent = normalizeIntent(message);
  return /\b(rascunho|rascunhe)\b/.test(intent) &&
    /\b(produto|item)\b/.test(intent) &&
    /\b(prepare|preparar|crie|criar|monte|montar|salve|salvar)\b/.test(intent);
};

export const resolveKyrubiaDeterministicProductDraft = (
  message: string
): KyrubiaDeterministicProductDraft | null => {
  if (!isKyrubiaDeterministicProductDraftIntent(message)) return null;

  const name = quotedProductName(message);
  if (!name) return null;

  const description = labelledQuotedText(message, /descri[cç][aã]o/, 800);
  const category = labelledQuotedText(message, /categoria/, 120);
  const price = labelledPrice(message);
  const stock = labelledStock(message);

  const product: KyrubCatalogDraftProductInput = { name };
  const fieldProvenance: KyrubiaDeterministicProductDraft['fieldProvenance'] = {
    name: 'user_intent',
  };

  if (description !== undefined) {
    product.description = description;
    fieldProvenance.description = 'user_intent';
  }
  if (category !== undefined) {
    product.category = category;
    fieldProvenance.category = 'user_intent';
  }
  if (price !== undefined) {
    product.price = price;
    fieldProvenance.price = 'user_intent';
  }
  if (stock !== undefined) {
    product.stock = stock;
    fieldProvenance.stock = 'user_intent';
  }

  const issues: KyrubCatalogDraftIssue[] = [];
  if (price === undefined) {
    issues.push({
      code: 'missing_required_field',
      field: 'price',
      message: 'Preço ainda não informado no rascunho.',
    });
  }
  if (category === undefined) {
    issues.push({
      code: 'missing_required_field',
      field: 'category',
      message: 'Categoria ainda não informada no rascunho.',
    });
  }

  return { product, fieldProvenance, issues };
};
