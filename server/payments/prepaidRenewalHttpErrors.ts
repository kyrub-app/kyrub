import { ConsultantHttpError } from '../ai/types.js';

/**
 * Shared HTTP error mapping for prepaid renewal operations.
 * Pure function: safe to exercise without provider or database access.
 */
export const mapPrepaidRenewalHttpError = (error: unknown): {
  status: number;
  body: { error: string; code: string };
} | null => {
  if (error instanceof ConsultantHttpError) {
    return { status: error.status, body: { error: error.message, code: error.code } };
  }
  const code = error instanceof Error ? error.message : '';
  const status = code === 'RENEWAL_PIX_CHECKOUT_DISABLED' ? 503
    : code === 'RENEWAL_SELLER_NOT_AUTHORIZED' ? 403
    : code === 'RENEWAL_PROPOSAL_NOT_FOUND' ||
      code === 'RENEWAL_PREVIOUS_CONTRACT_NOT_FOUND' ||
      code === 'RENEWAL_PRODUCT_NOT_FOUND' ? 404
    : code === 'RENEWAL_PROVIDER_PAYMENT_MISMATCH' ||
      code === 'RENEWAL_PAYMENT_NOT_CONFIRMED' ||
      code === 'RENEWAL_SELLER_ACCOUNT_NOT_VERIFIED' ? 422
    : code.startsWith('INVALID_RENEWAL_') ? 400
    : code.startsWith('RENEWAL_') ? 409 : 0;
  if (!status) return null;
  return {
    status,
    body: {
      error: status === 503 ? 'O checkout Pix de renovação ainda não foi liberado.'
        : status === 403 ? 'A operação exige o proprietário da loja.'
        : status === 404 ? 'A proposta, contrato ou produto não foi encontrado.'
        : status === 400 ? 'Os dados da renovação são inválidos.'
        : status === 422 ? 'O pagamento não foi confirmado para esta renovação.'
        : 'Esta renovação não está disponível nas condições atuais.',
      code,
    },
  };
};
