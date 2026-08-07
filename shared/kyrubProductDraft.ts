import {
  KYRUB_PLANNED_ERP_ACTION_TYPES,
  type KyrubActionOrigin,
  type KyrubAiCreateProductDraftProposal,
  type KyrubProductDraftMissingField,
  type KyrubProductDraftSource,
} from './kyrubActions';

const MAX_NAME = 180;
const MAX_DESCRIPTION = 4_000;
const MAX_CATEGORY = 120;
const MAX_IMAGE = 2_000;

export type KyrubProductDraftInput = {
  name?: unknown;
  description?: unknown;
  category?: unknown;
  price?: unknown;
  stock?: unknown;
  isService?: unknown;
  image?: unknown;
  source?: unknown;
};

export type KyrubProductDraftBuildOptions = {
  id: string;
  origin?: KyrubActionOrigin;
  idempotencyKey?: string;
};

const cleanText = (value: unknown, maximum: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : '';

const optionalMoney = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.round(value * 100) / 100;
};

const optionalStock = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.trunc(value);
};

const normalizeSource = (value: unknown): KyrubProductDraftSource =>
  value === 'catalog_analysis' ? 'catalog_analysis' : 'conversation';

export const buildKyrubProductDraftProposal = (
  input: KyrubProductDraftInput,
  options: KyrubProductDraftBuildOptions
): KyrubAiCreateProductDraftProposal => {
  const id = cleanText(options.id, 160);
  const name = cleanText(input.name, MAX_NAME);
  if (!id) throw new Error('A proposta de produto precisa de um identificador.');
  if (!name) throw new Error('Informe o nome do produto ou serviço.');

  const isService = input.isService === true;
  const category = cleanText(input.category, MAX_CATEGORY);
  const price = optionalMoney(input.price);
  const stock = isService ? 0 : optionalStock(input.stock);
  const missingFields: KyrubProductDraftMissingField[] = [];

  if (!category) missingFields.push('category');
  if (price === null) missingFields.push('price');
  if (!isService && stock === null) missingFields.push('stock');

  return {
    id,
    type: KYRUB_PLANNED_ERP_ACTION_TYPES.CREATE_PRODUCT_DRAFT,
    name,
    description: cleanText(input.description, MAX_DESCRIPTION),
    category,
    price,
    stock,
    isService,
    image: cleanText(input.image, MAX_IMAGE),
    source: normalizeSource(input.source),
    missingFields,
    requiresConfirmation: true,
    executable: false,
    origin: options.origin ?? 'kyrubia',
    risk: 'medium',
    ...(options.idempotencyKey
      ? { idempotencyKey: cleanText(options.idempotencyKey, 200) }
      : {}),
  };
};

export const isKyrubProductDraftReadyForExecution = (
  proposal: KyrubAiCreateProductDraftProposal
): boolean => proposal.missingFields.length === 0;
