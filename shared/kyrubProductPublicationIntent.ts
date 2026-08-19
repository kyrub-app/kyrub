export type KyrubProductPublicationIntent = {
  productName: string;
  published: boolean;
};

const stripQuotes = (value: string): string =>
  value.trim().replace(/^["“”']+/, '').replace(/["“”']+$/, '').trim();

export const parseKyrubProductPublicationIntent = (
  message: string
): KyrubProductPublicationIntent | null => {
  const text = message.trim();
  if (!text) return null;

  const publish = /\b(?:publique|publicar|publique\s+na\s+vitrine|coloque\s+na\s+vitrine)\s+(?:o\s+)?(?:produto|item|servi[cç]o)\s+(.+?)\s*$/i.exec(text);
  if (publish?.[1]) {
    const productName = stripQuotes(publish[1]);
    return productName && productName.length <= 160
      ? { productName, published: true }
      : null;
  }

  const unpublish = /\b(?:despublique|despublicar|retire\s+da\s+vitrine|remova\s+da\s+vitrine)\s+(?:o\s+)?(?:produto|item|servi[cç]o)\s+(.+?)\s*$/i.exec(text);
  if (unpublish?.[1]) {
    const productName = stripQuotes(unpublish[1]);
    return productName && productName.length <= 160
      ? { productName, published: false }
      : null;
  }

  return null;
};

export const isKyrubProductPublicationIntent = (message: string): boolean =>
  parseKyrubProductPublicationIntent(message) !== null;
