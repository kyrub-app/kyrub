/**
 * Isolated HTTP boundary for prepaid renewal reconciliation.
 * Dependencies are injected so route behavior can be tested without Firebase or Mercado Pago.
 */
type RenewalRequest = {
  method: string;
  body: Record<string, unknown>;
  authorization: string;
};
type RenewalResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): RenewalResponse;
  json(body: unknown): void;
};
type Reconcile = (input: {
  authorization: string;
  storeId: string;
  proposalId: string;
  paymentId: string;
}) => Promise<string>;

export const handlePrepaidRenewalReconciliation = async (
  request: RenewalRequest,
  response: RenewalResponse,
  reconcile: Reconcile,
): Promise<void> => {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
    return;
  }
  const body = request.body;
  if (Object.keys(body).some(key => !['storeId', 'proposalId', 'paymentId'].includes(key)) ||
      typeof body.storeId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(body.storeId) ||
      typeof body.proposalId !== 'string' ||
      !/^[a-f0-9]{64}$/.test(body.proposalId) ||
      typeof body.paymentId !== 'string' ||
      !/^\d{1,32}$/.test(body.paymentId)) {
    response.status(400).json({
      error: 'Informe loja, proposta aceita e identificador do pagamento.',
      code: 'INVALID_RENEWAL_RECONCILIATION_REQUEST',
    });
    return;
  }
  const status = await reconcile({
    authorization: request.authorization,
    storeId: body.storeId,
    proposalId: body.proposalId,
    paymentId: body.paymentId,
  });
  response.setHeader('cache-control', 'no-store, max-age=0');
  response.status(200).json({ status });
};
