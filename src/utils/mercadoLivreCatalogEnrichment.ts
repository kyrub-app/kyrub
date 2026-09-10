import type { User } from 'firebase/auth';

const encoded = (value: string): string => encodeURIComponent(value.trim());

export interface MercadoLivreCanonicalEnrichmentResult {
  proposalId: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  appliedFactCount: number;
  canonicalKeys: string[];
  factFingerprint: string;
  alreadyApplied: boolean;
  authority: 'store_owner_confirmed_external_taxonomy_enrichment';
  enrichedAt: string;
}

export const enrichMercadoLivreCanonicalProduct = async (
  user: User,
  storeId: string,
  proposalId: string
): Promise<MercadoLivreCanonicalEnrichmentResult> => {
  const token = await user.getIdToken();
  const response = await fetch(
    `/api/store-connections/mercado-livre/${encoded(storeId)}/outbound-publication-proposals/${encoded(proposalId)}/enrich-canonical-product`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: { authorization: `Bearer ${token}` },
    }
  );
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : `Não foi possível enriquecer o produto Kyrub (${response.status}).`;
    const code = typeof payload.code === 'string' ? payload.code : '';
    throw new Error(code ? `${message} (${code})` : message);
  }
  return payload as unknown as MercadoLivreCanonicalEnrichmentResult;
};
