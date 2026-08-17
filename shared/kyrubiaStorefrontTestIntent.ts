export type KyrubiaStorefrontTestCandidate = {
  id: string;
  name: string;
  category: string;
  price: number;
  hasDescription: boolean;
  hasImage: boolean;
};

export type KyrubiaStorefrontTestSelection = {
  main: KyrubiaStorefrontTestCandidate;
  dessert: KyrubiaStorefrontTestCandidate;
};

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const isKyrubiaStorefrontTestRequest = (message: string): boolean => {
  const intent = normalize(message);
  const testGoal =
    /\bteste\b/.test(intent) &&
    /\b(compra|comprar|pedido|pedir|cliente)\b/.test(intent);
  const preparation =
    /\b(prepare|preparar|organize|organizar|configure|configurar|publique|publicar)\b/.test(intent);
  const mainItem = /\b(hamburguer|hamburgueres|burger|burgers|lanche|lanches)\b/.test(intent);
  const dessert = /\b(sobremesa|sobremesas|doce|doces)\b/.test(intent);
  return testGoal && preparation && mainItem && dessert;
};

const mainScore = (candidate: KyrubiaStorefrontTestCandidate): number => {
  const text = normalize(`${candidate.name} ${candidate.category}`);
  let score = 0;
  if (/\bx burger\b/.test(text)) score += 12;
  if (/\b(burger|burgers|hamburguer|hamburgueres)\b/.test(text)) score += 9;
  if (/\blanche|lanches\b/.test(text)) score += 4;
  if (/\bsobremesa|sundae|taca\b/.test(text)) score -= 12;
  if (candidate.price > 0) score += 1;
  return score;
};

const dessertScore = (candidate: KyrubiaStorefrontTestCandidate): number => {
  const text = normalize(`${candidate.name} ${candidate.category}`);
  let score = 0;
  if (/\bsobremesa|sobremesas\b/.test(text)) score += 12;
  if (/\b(sundae|taca|banana|petit|brownie|sorvete|doce)\b/.test(text)) score += 8;
  if (/\b(burger|hamburguer|lanche)\b/.test(text)) score -= 12;
  if (candidate.price > 0) score += 1;
  return score;
};

const bestCandidate = (
  candidates: KyrubiaStorefrontTestCandidate[],
  scorer: (candidate: KyrubiaStorefrontTestCandidate) => number,
  excludedId = ''
): KyrubiaStorefrontTestCandidate | null => {
  const ranked = candidates
    .filter(candidate => candidate.id !== excludedId)
    .map(candidate => ({ candidate, score: scorer(candidate) }))
    .filter(item => item.score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      left.candidate.name.localeCompare(right.candidate.name, 'pt-BR')
    );
  return ranked[0]?.candidate ?? null;
};

export const selectKyrubiaStorefrontTestProducts = (
  candidates: KyrubiaStorefrontTestCandidate[]
): KyrubiaStorefrontTestSelection | null => {
  const main = bestCandidate(candidates, mainScore);
  if (!main) return null;
  const dessert = bestCandidate(candidates, dessertScore, main.id);
  return dessert ? { main, dessert } : null;
};
