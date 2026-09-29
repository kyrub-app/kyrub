import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadOwnerStoreInstitutionalRepresentation } from '../store/storeInstitutionalIdentityService.js';
import { cancelOrderItemsWithAuthoritativeRefund } from './authoritativeOrderItemCancellationService.js';
import { assertFullRefundHasNoConfirmedPartialHistory } from './partialRefundSafetyService.js';
import { requestCanonicalOrderRefund } from './paymentRefundService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const mapRefundError = (error: unknown): {
  status: number;
  error: string;
  code: string;
} => {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'AUTH_REQUIRED' || /id-token|expired|revoked/i.test(code)) {
    return { status: 401, error: 'Faça login novamente.', code: 'AUTH_REQUIRED' };
  }
  if (code === 'STORE_REPRESENTATION_FORBIDDEN') {
    return { status: 403, error: 'Você não pode alterar pedidos desta loja.', code };
  }
  if (
    code === 'ORDER_ITEM_CANCELLATION_TARGET_REQUIRED' ||
    code === 'ORDER_ITEM_CANCELLATION_OPERATION_REQUIRED' ||
    code === 'ORDER_ITEM_CANCELLATION_SELECTION_REQUIRED' ||
    code === 'ORDER_ITEM_CANCELLATION_SELECTION_INVALID'
  ) {
    return { status: 400, error: 'Escolha os itens e as quantidades que serão cancelados.', code };
  }
  if (code === 'ORDER_ITEM_CANCELLATION_REASON_REQUIRED') {
    return { status: 400, error: 'Informe o motivo do cancelamento.', code };
  }
  if (code === 'ORDER_ITEM_CANCELLATION_ORDER_NOT_FOUND') {
    return { status: 404, error: 'Pedido não encontrado.', code };
  }
  if (code === 'ORDER_ITEM_CANCELLATION_ORDER_NOT_PENDING') {
    return { status: 409, error: 'O cancelamento parcial desta etapa só pode ser feito antes do aceite do pedido.', code };
  }
  if (
    code === 'ORDER_ITEM_CANCELLATION_QUANTITY_EXCEEDED' ||
    code === 'ORDER_ITEM_CANCELLATION_TRANSFERRED_QUANTITY'
  ) {
    return { status: 409, error: 'A quantidade escolhida já não está disponível para cancelamento.', code };
  }
  if (code === 'ORDER_ITEM_CANCELLATION_LINE_NOT_FOUND') {
    return { status: 409, error: 'Um dos itens selecionados não pertence mais a este pedido. Reabra a recusa e revise a lista.', code };
  }
  if (code === 'ORDER_ITEM_CANCELLATION_USE_FULL_REJECTION') {
    return { status: 409, error: 'Você selecionou todos os itens. Use “Pedido inteiro” para concluir a recusa.', code };
  }
  if (code.startsWith('ORDER_COMMERCIAL_REFUND_')) {
    return {
      status: 409,
      error: 'A composição financeira original deste pedido não confere com o estado atual. O reembolso automático foi bloqueado para evitar um valor incorreto.',
      code,
    };
  }
  if (code.startsWith('ORDER_ITEM_CANCELLATION_')) {
    return { status: 409, error: 'O pedido mudou enquanto você fazia a seleção. Revise os itens antes de confirmar.', code };
  }
  if (code === 'PAYMENT_REFUND_PARTIAL_HISTORY_REQUIRES_RESIDUAL') {
    return {
      status: 409,
      error: 'Este pagamento já teve reembolso parcial. O restante precisa ser conciliado pelo fluxo de reembolso residual antes de um cancelamento financeiro integral.',
      code,
    };
  }
  if (code === 'PAYMENT_REFUND_ORDER_NOT_FOUND' || code === 'PAYMENT_REFUND_PAYMENT_NOT_FOUND') {
    return { status: 404, error: 'Não encontramos o pagamento canônico deste pedido.', code };
  }
  if (code === 'PAYMENT_REFUND_MULTIPLE_PAYMENTS_UNSUPPORTED') {
    return { status: 409, error: 'Este pedido possui mais de um pagamento elegível. O reembolso múltiplo ainda exige revisão financeira.', code };
  }
  if (code === 'PAYMENT_REFUND_ORDER_NOT_TERMINAL') {
    return { status: 409, error: 'Recuse ou cancele o pedido antes de solicitar o reembolso.', code };
  }
  if (code === 'PAYMENT_REFUND_ORDER_NOT_PAID') {
    return { status: 409, error: 'Este pedido não possui pagamento confirmado para reembolso.', code };
  }
  if (code === 'PAYMENT_REFUND_REASON_REQUIRED') {
    return { status: 400, error: 'Informe o motivo do reembolso.', code };
  }
  if (code === 'MERCADO_PAGO_REFUND_TOO_OLD') {
    return { status: 409, error: 'O Mercado Pago informou que esse pagamento ultrapassou o prazo permitido para reembolso.', code };
  }
  if (code === 'MERCADO_PAGO_REFUND_NOT_ALLOWED') {
    return { status: 409, error: 'O Mercado Pago não permite reembolsar essa cobrança neste estado.', code };
  }
  if (code === 'MERCADO_PAGO_NOT_CONFIGURED') {
    return { status: 503, error: 'A conta Mercado Pago responsável por esta cobrança não está disponível para reembolso.', code };
  }
  if (code === 'MERCADO_PAGO_REFUND_STATUS_UNCERTAIN') {
    return { status: 503, error: 'A solicitação chegou ao provedor, mas o resultado ainda é incerto. Use “Verificar reembolso” antes de tentar outra operação.', code };
  }
  if (code.startsWith('PAYMENT_REFUND_') || code.startsWith('MERCADO_PAGO_')) {
    return { status: 409, error: 'Não foi possível concluir o reembolso agora. O pagamento original foi preservado para nova verificação.', code };
  }
  console.error('[Store payment refund]', error);
  return { status: 503, error: 'Não foi possível processar a operação agora.', code: 'PAYMENT_REFUND_UNAVAILABLE' };
};

const requireOwner = async (authorization: string, storeId: string): Promise<void> => {
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  await loadOwnerStoreInstitutionalRepresentation({
    storeId,
    authenticatedUserId: identity.uid,
  });
};

export const createStorePaymentRefundRouter = (): Router => {
  const router = Router();

  router.post('/', async (request, response) => {
    try {
      const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
        ? request.body as Record<string, unknown>
        : {};
      const storeId = clean(body.storeId);
      const orderId = clean(body.orderId);
      const reason = clean(body.reason);
      if (!storeId || !orderId) throw new Error('PAYMENT_REFUND_TARGET_REQUIRED');
      await requireOwner(request.get('authorization') ?? '', storeId);

      if (clean(body.operation) === 'cancel-items') {
        const result = await cancelOrderItemsWithAuthoritativeRefund({
          storeId,
          orderId,
          operationId: clean(body.operationId),
          reason,
          alternative: clean(body.alternative),
          selections: body.selections,
        });
        response
          .status(result.refundStatus === 'processing' ? 202 : 200)
          .json(result);
        return;
      }

      await assertFullRefundHasNoConfirmedPartialHistory({ storeId, orderId });
      const result = await requestCanonicalOrderRefund({ storeId, orderId, reason });
      response.status(result.status === 'refunded' ? 200 : 202).json(result);
    } catch (error) {
      const mapped = mapRefundError(error);
      response.status(mapped.status).json({ error: mapped.error, code: mapped.code });
    }
  });

  return router;
};
