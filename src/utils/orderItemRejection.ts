import { auth } from './firebase';

export interface OrderItemRejectionLine {
  lineId: string;
  quantity: number;
}

interface OrderItemRejectionResponse {
  orderId?: string;
  status?: string;
  paymentStatus?: string;
  cancelledAmount?: number;
  error?: string;
  code?: string;
}

export const rejectPendingOrderItems = async (input: {
  storeId: string;
  orderId: string;
  reason: string;
  alternative?: string;
  lines: OrderItemRejectionLine[];
}): Promise<OrderItemRejectionResponse> => {
  const storeId = input.storeId.trim();
  const orderId = input.orderId.trim();
  const reason = input.reason.trim();
  const user = auth.currentUser;
  if (!user || !storeId || user.uid !== storeId) {
    throw new Error('Faça login novamente para alterar este pedido.');
  }
  if (!orderId || !reason || input.lines.length === 0) {
    throw new Error('Informe o motivo e escolha ao menos um item para recusar.');
  }

  const token = await user.getIdToken();
  const response = await fetch(
    '/api/health?transport=store-promotions&surface=refunds&path=item-rejections',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        storeId,
        orderId,
        reason,
        alternative: input.alternative?.trim() ?? '',
        lines: input.lines,
      }),
    }
  );
  const payload = await response.json().catch(() => ({})) as OrderItemRejectionResponse;
  if (!response.ok) {
    throw new Error(payload.error || 'Não foi possível recusar os itens escolhidos.');
  }
  return payload;
};
