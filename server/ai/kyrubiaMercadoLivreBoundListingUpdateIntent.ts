export type KyrubiaMercadoLivreBoundListingUpdatePreparationCommand = {
  requestedBindingId?: string;
};

export type ExplicitMercadoLivreBoundListingUpdateAuthorization = {
  proposalId: string;
  externalItemId: string;
  fromPrice: number;
  toPrice: number;
};

const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();

const normalizeExplicitCommand = (message: string): string =>
  clean(message).replace(/[!?…]+$/u, '').trim();

const parseBrazilianMoney = (value: string): number | null => {
  const normalized = value.replace(/\./g, '').replace(',', '.').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

export const parseKyrubiaMercadoLivreBoundListingUpdatePreparationCommand = (
  message: string
): KyrubiaMercadoLivreBoundListingUpdatePreparationCommand | null => {
  const normalized = normalizeExplicitCommand(message);
  const match = /^(?:preparar|prepare)(?:\s+a)?\s+atualiza(?:ção|cao)\s+(?:(?:da|de)\s+publica(?:ção|cao)|do\s+an[uú]ncio)(?:\s+id\s+([a-zA-Z0-9_-]{1,180}))?\.?$/i.exec(normalized);
  if (!match) return null;
  return match[1] ? { requestedBindingId: match[1] } : {};
};

export const isExplicitMercadoLivreBoundListingUpdateAuthorizationAttempt = (
  message: string
): boolean => /^autorizo\s+a\s+proposta\s+mlupd_[a-z0-9_-]+\b/i.test(clean(message));

export const parseExplicitMercadoLivreBoundListingUpdateAuthorization = (
  message: string
): ExplicitMercadoLivreBoundListingUpdateAuthorization | null => {
  const normalized = clean(message);
  if (!isExplicitMercadoLivreBoundListingUpdateAuthorizationAttempt(normalized)) return null;

  const proposalId = /^autorizo\s+a\s+proposta\s+(mlupd_[a-z0-9_-]{8,180})\b/i.exec(normalized)?.[1] ?? '';
  const externalItemId = /\bitem\s+(MLB\d{5,30})\b/i.exec(normalized)?.[1]?.toUpperCase() ?? '';
  const prices = /\bde\s+R\$\s*([\d.]+,\d{2})\s+para\s+R\$\s*([\d.]+,\d{2})\b/i.exec(normalized);
  const fromPrice = prices ? parseBrazilianMoney(prices[1]) : null;
  const toPrice = prices ? parseBrazilianMoney(prices[2]) : null;

  const normalizedSemantic = normalized
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
  const priceOnly = /atualizar\s+exclusivamente\s+o\s+preco/.test(normalizedSemantic);
  const protectsStock = /nao\s+altere\s+estoque/.test(normalizedSemantic);
  const protectsCategory = /categoria/.test(normalizedSemantic);
  const protectsImages = /imagens?/.test(normalizedSemantic);
  const protectsPublicationStatus = /status\s+da\s+publicacao/.test(normalizedSemantic);

  if (
    !proposalId ||
    !externalItemId ||
    fromPrice === null ||
    toPrice === null ||
    !priceOnly ||
    !protectsStock ||
    !protectsCategory ||
    !protectsImages ||
    !protectsPublicationStatus
  ) return null;

  return { proposalId, externalItemId, fromPrice, toPrice };
};

export const isKyrubiaMercadoLivreBoundListingUpdateCommandText = (
  message: string
): boolean => Boolean(
  parseKyrubiaMercadoLivreBoundListingUpdatePreparationCommand(message) ||
  isExplicitMercadoLivreBoundListingUpdateAuthorizationAttempt(message)
);
