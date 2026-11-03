import type { buildPrepaidRenewalPixRequest } from './prepaidRenewalPixRequest.js';
import { validatePrepaidRenewalPixTransportAuthority } from './prepaidRenewalPixTransportAuthority.js';

type PixRequest = ReturnType<typeof buildPrepaidRenewalPixRequest>;

/**
 * Explicit boundary between the isolated executor and a seller-scoped
 * transport. The transport is injected; this module never imports live
 * Mercado Pago credentials, Firebase or HTTP routes.
 *
 * The trusted identity MUST be resolved independently on the server, never
 * supplied by a browser. Do not expose this adapter as an HTTP endpoint.
 */
export const createAuthorityCheckedPrepaidRenewalPixTransport = (input: {
  storeId: string;
  proposalId: string;
  request: PixRequest;
  trustedCredentialScopeId: string;
  oauthCredentialScopeId: string;
  trustedExternalAccountId: string;
  oauthExternalAccountId: string;
  sellerScopedRequest: (credentialScopeId: string, path: string, init: PixRequest['init']) => Promise<unknown>;
}) => {
  const verify = () => validatePrepaidRenewalPixTransportAuthority(input);
  return {
    createPayment: async (request: PixRequest): Promise<unknown> => {
      verify();
      if (request.path !== input.request.path ||
          request.init.method !== input.request.init.method ||
          request.init.headers['X-Idempotency-Key'] !== input.request.init.headers['X-Idempotency-Key'] ||
          request.init.body !== input.request.init.body) {
        throw new Error('RENEWAL_PIX_ATTEMPT_PAYLOAD_CHANGED');
      }
      return input.sellerScopedRequest(input.trustedCredentialScopeId, request.path, request.init);
    },
    fetchPayment: async (paymentId: string): Promise<unknown> => {
      verify();
      if (!/^\\d{1,32}$/.test(paymentId)) {
        throw new Error('INVALID_RENEWAL_PAYMENT_LOOKUP');
      }
      return input.sellerScopedRequest(input.trustedCredentialScopeId,
        `/v1/payments/${paymentId}`, { method: 'GET' } as PixRequest['init']);
    },
  };
};
