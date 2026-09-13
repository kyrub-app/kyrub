const clean = (value: unknown, maximum = 240): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const stripOneMatchingOuterQuotePair = (value: string): string => {
  const text = clean(value, 180);
  if (text.length < 2) return text;
  const first = text[0];
  const last = text.at(-1) ?? '';
  const matching =
    (first === '"' && last === '"') ||
    (first === "'" && last === "'") ||
    (first === '“' && last === '”') ||
    (first === '‘' && last === '’') ||
    (first === '`' && last === '`');
  return matching ? clean(text.slice(1, -1), 180) : text;
};

export const extractKyrubiaMercadoLivrePreparationTarget = (
  message: string
): string => {
  const text = clean(message, 600);
  if (!text) return '';
  const match = /^(?:kyrubia\s*[,,:-]?\s*)?(?:prepare|preparar)\s+(?:(?:o|a|um|uma)\s+)?(.+?)\s+para\s+(?:(?:vender|anunciar|publicar)\s+)?(?:tamb[eé]m\s+)?(?:(?:no|na|o|a)\s+)?mercado\s+livre[.!?\s]*$/i.exec(text);
  return stripOneMatchingOuterQuotePair(clean(match?.[1], 180));
};
