import type { KyrubErpContextSnapshot, KyrubErpProductSummary } from '../../shared/kyrubErpContext';
import {
  normalizeCreateStorePromotionProposal,
  type CreateStorePromotionProposal,
} from '../../shared/storePromotionAction';

export const KYRUBIA_UNLIMITED_PROMOTION_ENDS_AT = '9999-12-31T23:59:59.999Z';

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const localizedNumber = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const isKyrubiaStorePromotionIntent = (message: string): boolean => {
  const intent = normalize(message);
  const action = /\b(?:libera|libere|cria|crie|ative|ativar|coloca|coloque|aplica|aplique|ofereca|oferecer|da|de|gera|gere)\b/.test(intent);
  const benefit = /\b(?:cupom|desconto|promocao|oferta|off)\b/.test(intent) || /\d+(?:[.,]\d+)?\s*%/.test(intent);
  return action && benefit;
};

const parseDiscount = (message: string): {
  discountType: 'percentage' | 'fixed';
  discountValue: number;
} | null => {
  const percentageMatch = /(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:%|por\s+cento)/i.exec(message);
  const percentage = localizedNumber(percentageMatch?.[1]);
  if (percentage !== undefined && percentage > 0 && percentage < 100) {
    return { discountType: 'percentage', discountValue: percentage };
  }

  const fixedMatch = /(?:desconto|cupom|oferta)[^\n]{0,24}?r\$\s*(\d+(?:[.,]\d{1,2})?)/i.exec(message);
  const fixed = localizedNumber(fixedMatch?.[1]);
  if (fixed !== undefined && fixed > 0) {
    return { discountType: 'fixed', discountValue: fixed };
  }

  return null;
};

const productAliases = (product: KyrubErpProductSummary): string[] => {
  const name = normalize(product.name);
  const aliases = new Set<string>();
  if (name) aliases.add(name);

  // Public catalog names may be prefixed by a numeric SKU, e.g. "002 X-BURGER".
  // Users naturally refer to the sellable name ("X-Burger"), so keep both forms.
  const withoutNumericPrefix = name.replace(/^\d{1,12}\s+/, '').trim();
  if (withoutNumericPrefix) aliases.add(withoutNumericPrefix);

  const burgerCandidate = withoutNumericPrefix || name;
  if (/\bx\s*burger\b/.test(burgerCandidate) || /\bxburger\b/.test(burgerCandidate)) {
    aliases.add('x burger');
    aliases.add('xburger');
    aliases.add('cheeseburger');
    aliases.add('cheese burger');
  }

  return [...aliases].filter(Boolean);
};

const resolveProduct = (
  message: string,
  products: KyrubErpProductSummary[]
): KyrubErpProductSummary | null => {
  const intent = normalize(message);
  const matches = products
    .flatMap(product => {
      const aliases = productAliases(product);
      const matchingAliases = aliases.filter(alias => intent.includes(alias));
      return matchingAliases.length > 0
        ? [{ product, score: Math.max(...matchingAliases.map(alias => alias.length)) }]
        : [];
    })
    .sort((left, right) => right.score - left.score);

  if (matches.length === 1) return matches[0]?.product ?? null;
  if (matches.length > 1 && matches[0]!.score > matches[1]!.score) {
    return matches[0]!.product;
  }
  return null;
};

const isUnlimitedDuration = (message: string): boolean => {
  const intent = normalize(message);
  return /\b(?:tempo\s+)?ilimitad[oa]\b/.test(intent) ||
    /\bsem\s+(?:prazo|validade|data\s+final|vencimento)\b/.test(intent) ||
    /\bnao\s+expira\b/.test(intent);
};

const parseEndsAt = (message: string, startsAt: Date): Date => {
  const normalizedMessage = normalize(message);
  if (isUnlimitedDuration(message)) {
    return new Date(KYRUBIA_UNLIMITED_PROMOTION_ENDS_AT);
  }
  if (/\bate\s+(?:a\s+)?meia noite\b/.test(normalizedMessage)) {
    const end = new Date(startsAt);
    end.setHours(24, 0, 0, 0);
    return end;
  }

  const durationMatch = /\bpor\s+(\d+)\s*(minutos?|horas?|dias?)\b/i.exec(normalizedMessage);
  if (!durationMatch) return new Date(startsAt.getTime() + 24 * 60 * 60 * 1000);

  const amount = Number.parseInt(durationMatch[1] ?? '', 10);
  const unit = durationMatch[2] ?? '';
  if (!Number.isInteger(amount) || amount <= 0) {
    return new Date(startsAt.getTime() + 24 * 60 * 60 * 1000);
  }
  const multiplier = unit.startsWith('minuto')
    ? 60 * 1000
    : unit.startsWith('hora')
      ? 60 * 60 * 1000
      : 24 * 60 * 60 * 1000;
  return new Date(startsAt.getTime() + amount * multiplier);
};

const parseMaxRedemptions = (message: string): number => {
  const intent = normalize(message);
  const match = /\b(?:primeiros?|limite(?:\s+de)?|ate)\s+(\d+)\s*(?:clientes?|vendas?|cupons?|resgates?)?\b/.exec(intent);
  const value = Number.parseInt(match?.[1] ?? '', 10);
  return Number.isInteger(value) && value > 0 ? value : 0;
};

const parsePerBuyerLimit = (message: string): number => {
  const intent = normalize(message);
  const match = /\b(\d+)\s*(?:vez|vezes|uso|usos|cupom|cupons)\s+por\s+(?:cliente|usuario|pessoa)\b/.exec(intent);
  const value = Number.parseInt(match?.[1] ?? '', 10);
  return Number.isInteger(value) && value >= 0 ? value : 1;
};

const parseCode = (message: string): string | undefined => {
  const match = /\b(?:codigo|c[oó]digo)\s+(?:do\s+cupom\s+)?["“']?([a-z0-9_-]{3,48})["”']?/i.exec(message);
  return match?.[1]?.trim();
};

const percentageText = (value: number): string =>
  `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value)}%`;

export type DeterministicStorePromotionResolution = {
  reply: string;
  proposal: CreateStorePromotionProposal;
};

export const resolveKyrubiaDeterministicStorePromotion = (
  message: string,
  context: KyrubErpContextSnapshot | undefined,
  now = new Date()
): DeterministicStorePromotionResolution | null => {
  if (!isKyrubiaStorePromotionIntent(message) || context?.store?.configured !== true) return null;

  const discount = parseDiscount(message);
  if (!discount) return null;

  const product = resolveProduct(message, context.products ?? []);
  if (!product) return null;

  const startsAt = now;
  const endsAt = parseEndsAt(message, startsAt);
  const explicitCode = parseCode(message);
  const proposal = normalizeCreateStorePromotionProposal({
    id: `promotion-intent:${context.store.id}:${product.id}:${now.getTime()}`,
    type: 'create_store_promotion',
    storeId: context.store.id,
    productIds: [product.id],
    productLabel: product.name,
    ...(explicitCode ? { code: explicitCode } : {}),
    discountType: discount.discountType,
    discountValue: discount.discountValue,
    eligibilityMode: 'public',
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    maxRedemptions: parseMaxRedemptions(message),
    maxRedemptionsPerBuyer: parsePerBuyerLimit(message),
    requiresConfirmation: true,
    origin: 'kyrubia',
  });

  const benefit = proposal.discountType === 'percentage'
    ? percentageText(proposal.discountValue)
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(proposal.discountValue);
  const globalLimit = proposal.maxRedemptions > 0
    ? `, limitado a ${proposal.maxRedemptions} resgates`
    : '';
  const validity = proposal.endsAt === KYRUBIA_UNLIMITED_PROMOTION_ENDS_AT
    ? ', sem data final'
    : '';

  return {
    reply: `Preparei uma promoção pública de ${benefit} para “${product.name}”, com cupom ${proposal.code}${globalLimit}${validity}. Revise e confirme antes de eu publicar na vitrine.`,
    proposal,
  };
};
