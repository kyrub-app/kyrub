export type KyrubProductPublicationIntent = {
  productName: string;
  productId?: string;
  published: boolean;
};

const stripQuotes = (value: string): string =>
  value.trim().replace(/^["“”']+/, '').replace(/["“”']+$/, '').trim();

const parsePublicationTarget = (
  value: string
): Pick<KyrubProductPublicationIntent, 'productName' | 'productId'> | null => {
  const target = stripQuotes(value);
  if (!target) return null;

  if (/^id\b/i.test(target)) {
    const match = /^id\s+([a-zA-Z0-9_-]+)$/i.exec(target);
    const productId = match?.[1] ?? '';
    if (
      !productId ||
      !productId.startsWith('product-') ||
      productId.length > 128
    ) {
      return null;
    }
    return { productName: '', productId };
  }

  return target.length <= 160
    ? { productName: target }
    : null;
};

export const parseKyrubProductPublicationIntent = (
  message: string
): KyrubProductPublicationIntent | null => {
  const text = message.trim();
  if (!text) return null;

  const publish = /\b(?:publique|publicar|publique\s+na\s+vitrine|coloque\s+na\s+vitrine)\s+(?:o\s+)?(?:produto|item|servi[cç]o)\s+(.+?)\s*$/i.exec(text);
  if (publish?.[1]) {
    const target = parsePublicationTarget(publish[1]);
    return target ? { ...target, published: true } : null;
  }

  const unpublish = /\b(?:despublique|despublicar|retire\s+da\s+vitrine|remova\s+da\s+vitrine)\s+(?:o\s+)?(?:produto|item|servi[cç]o)\s+(.+?)\s*$/i.exec(text);
  if (unpublish?.[1]) {
    const target = parsePublicationTarget(unpublish[1]);
    return target ? { ...target, published: false } : null;
  }

  return null;
};

export const isKyrubProductPublicationIntent = (message: string): boolean =>
  parseKyrubProductPublicationIntent(message) !== null;
