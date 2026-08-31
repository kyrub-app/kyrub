import { createHash } from 'node:crypto';

const clean = (value: unknown, maximum = 240): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

export const mercadoLivrePublicationCorrelationMarker = (
  storeIdInput: string,
  proposalIdInput: string
): string => {
  const storeId = storeIdInput.trim();
  const proposalId = proposalIdInput.trim();
  if (!storeId || !proposalId) throw new Error('MERCADO_LIVRE_PUBLICATION_CORRELATION_TARGET_INVALID');
  const digest = createHash('sha256').update(`${storeId}:${proposalId}`).digest('hex').slice(0, 24);
  return `KRB-ML-${digest}`;
};

export const assertMercadoLivrePublicationCorrelationMarker = (value: unknown): string => {
  const marker = clean(value);
  if (!/^KRB-ML-[a-f0-9]{24}$/.test(marker)) {
    throw new Error('MERCADO_LIVRE_PUBLICATION_CORRELATION_UNAVAILABLE');
  }
  return marker;
};
