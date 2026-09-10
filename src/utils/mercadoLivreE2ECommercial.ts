import type { User } from 'firebase/auth';
import type { MercadoLivreSaleTermInput, MercadoLivreShippingInput } from './mercadoLivreE2ETest';

const encoded = (value: string): string => encodeURIComponent(value.trim());

export const configureMercadoLivreE2ECommercialRequirements = async (
  user: User,
  storeId: string,
  proposalId: string,
  input: { saleTerms: MercadoLivreSaleTermInput[]; shipping?: MercadoLivreShippingInput }
): Promise<{
  proposalId: string;
  saleTerms: MercadoLivreSaleTermInput[];
  shipping: MercadoLivreShippingInput | null;
  missingRequiredSaleTermIds: string[];
  configuredAt: string;
}> => {
  const token = await user.getIdToken();
  const response = await fetch(
    `/api/store-connections/mercado-livre/${encoded(storeId)}/e2e/outbound-publication-proposals/${encoded(proposalId)}/configure-commercial-requirements`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    }
  );
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : `Não foi possível concluir a configuração comercial (${response.status}).`;
    const code = typeof payload.code === 'string' ? payload.code : '';
    throw new Error(code ? `${message} (${code})` : message);
  }
  return payload as {
    proposalId: string;
    saleTerms: MercadoLivreSaleTermInput[];
    shipping: MercadoLivreShippingInput | null;
    missingRequiredSaleTermIds: string[];
    configuredAt: string;
  };
};
