import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadOwnerStoreInstitutionalRepresentation } from '../store/storeInstitutionalIdentityService.js';
import {
  closeLocalAttendanceSession,
  listLocalAttendanceSessions,
  openLocalAttendanceSession,
} from './localAttendanceService.js';
import {
  createServiceLocation,
  getServiceLocation,
  listServiceLocations,
  updateServiceLocation,
} from './serviceLocationService.js';
import { createInPersonOrderRouter } from './inPersonOrderRouter.js';
import { createInPersonCustomerIdentityRouter } from './inPersonCustomerIdentityRouter.js';
import { createLocalServiceRequestRouter } from './localServiceRequestRouter.js';
import { loadLocalOrderFinancialContext } from './localOrderFinancialContextService.js';
import { createLocalPaymentIntent } from './localPaymentIntentService.js';
import { attachMercadoPagoPixToLocalIntent } from './localMercadoPagoPixService.js';
import { loadPendingLocalPixAttempt } from './localPendingPixService.js';
import { isServiceLocationKind } from '../../shared/serviceLocation.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const requireStoreAuthority = async (input: {
  authorization: string;
  storeId: string;
}) => {
  const token = bearerToken(input.authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  const representation = await loadOwnerStoreInstitutionalRepresentation({
    storeId: input.storeId,
    authenticatedUserId: identity.uid,
  });
  return representation;
};

const mapError = (error: unknown): { status: number; message: string } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED') {
    return { status: 401, message: 'Faça login novamente para acessar o atendimento local.' };
  }
  if (
    message === 'STORE_REPRESENTATION_FORBIDDEN' ||
    message === 'LOCAL_PAYMENT_INTENT_FORBIDDEN' ||
    message === 'LOCAL_PIX_PROVIDER_FORBIDDEN' ||
    message === 'LOCAL_PIX_RECOVERY_FORBIDDEN'
  ) {
    return { status: 403, message: 'Você não pode operar o atendimento desta loja.' };
  }
  if (message === 'STORE_INSTITUTIONAL_NOT_FOUND') {
    return { status: 404, message: 'A loja ainda não está disponível para atendimento.' };
  }
  if (message === 'LOCAL_ATTENDANCE_NOT_FOUND') {
    return { status: 404, message: 'Atendimento não encontrado.' };
  }
  if (message === 'SERVICE_LOCATION_NOT_FOUND') {
    return { status: 404, message: 'Local de atendimento não encontrado.' };
  }
  if (message === 'SERVICE_LOCATION_INACTIVE') {
    return { status: 409, message: 'Este local de atendimento está desativado.' };
  }
  if (message === 'LOCAL_ORDER_FINANCIAL_ORDER_NOT_FOUND') {
    return { status: 404, message: 'Pedido não encontrado para leitura financeira.' };
  }
  if (message === 'LOCAL_ORDER_FINANCIAL_ORDER_NOT_LOCAL') {
    return { status: 409, message: 'Este pedido não pertence ao atendimento local.' };
  }
  if (message === 'LOCAL_PAYMENT_INTENT_ORDER_NOT_FOUND') {
    return { status: 404, message: 'Pedido presencial não encontrado.' };
  }
  if (
    message === 'LOCAL_PIX_PROVIDER_PAYMENT_STATE_MISSING' ||
    message === 'LOCAL_PIX_PROVIDER_ORDER_NOT_FOUND' ||
    message === 'LOCAL_PIX_PROVIDER_PAYER_NOT_FOUND'
  ) {
    return { status: 404, message: 'O pagamento presencial não está mais disponível.' };
  }
  if (
    message === 'LOCAL_PAYMENT_INTENT_ORDER_NOT_LOCAL' ||
    message === 'LOCAL_PAYMENT_INTENT_ORDER_CLOSED' ||
    message === 'LOCAL_PAYMENT_INTENT_CUSTOMER_IDENTIFICATION_REQUIRED' ||
    message === 'LOCAL_PAYMENT_INTENT_PAYER_NOT_FOUND' ||
    message === 'LOCAL_PAYMENT_INTENT_PAYER_EMAIL_REQUIRED' ||
    message === 'LOCAL_PAYMENT_INTENT_SERVICE_LOCATION_REQUIRED' ||
    message === 'LOCAL_PAYMENT_INTENT_PAYMENT_ALREADY_PENDING' ||
    message === 'LOCAL_PAYMENT_INTENT_RECONCILIATION_REQUIRED' ||
    message === 'LOCAL_PAYMENT_INTENT_ALREADY_PAID' ||
    message === 'LOCAL_PAYMENT_INTENT_IDEMPOTENCY_CONFLICT' ||
    message === 'LOCAL_PAYMENT_INTENT_PAYMENT_CONTEXT_CONFLICT'
  ) {
    return {
      status: 409,
      message:
        message === 'LOCAL_PAYMENT_INTENT_CUSTOMER_IDENTIFICATION_REQUIRED'
          ? 'Identifique o Cairubido antes de iniciar o pagamento deste pedido.'
          : message === 'LOCAL_PAYMENT_INTENT_PAYMENT_ALREADY_PENDING'
            ? 'Já existe um pagamento pendente para este pedido.'
            : message === 'LOCAL_PAYMENT_INTENT_ALREADY_PAID'
              ? 'Este pedido já possui quitação financeira canônica.'
              : message === 'LOCAL_PAYMENT_INTENT_RECONCILIATION_REQUIRED'
                ? 'A situação financeira deste pedido precisa ser conciliada antes de um novo pagamento.'
                : message === 'LOCAL_PAYMENT_INTENT_PAYER_EMAIL_REQUIRED' || message === 'LOCAL_PAYMENT_INTENT_PAYER_NOT_FOUND'
                  ? 'A conta do cliente ainda não possui dados suficientes para iniciar o pagamento.'
                  : 'Este pedido ainda não está apto para iniciar um pagamento canônico.',
    };
  }
  if (
    message === 'LOCAL_PIX_PROVIDER_ATTENDANCE_APPROVAL_REQUIRED' ||
    message === 'LOCAL_PIX_PROVIDER_CUSTOMER_IDENTIFICATION_REQUIRED' ||
    message === 'LOCAL_PIX_PROVIDER_PAYER_EMAIL_REQUIRED' ||
    message === 'LOCAL_PIX_PROVIDER_PAYMENT_NOT_PENDING' ||
    message === 'LOCAL_PIX_PROVIDER_INTENT_EXPIRED' ||
    message === 'LOCAL_PIX_PROVIDER_ORDER_NOT_ELIGIBLE' ||
    message === 'LOCAL_PIX_PROVIDER_BUYER_CHANGED' ||
    message === 'LOCAL_PIX_PROVIDER_CONTEXT_CHANGED' ||
    message === 'LOCAL_PIX_PROVIDER_OTHER_PAYMENT_PENDING' ||
    message === 'LOCAL_PIX_PROVIDER_INTENT_STALE' ||
    message === 'LOCAL_PIX_PROVIDER_PAYMENT_PAIR_MISMATCH' ||
    message === 'LOCAL_PIX_PROVIDER_BINDING_CONFLICT' ||
    message === 'LOCAL_PIX_PROVIDER_PAYMENT_CONTEXT_CONFLICT'
  ) {
    return {
      status: 409,
      message:
        message === 'LOCAL_PIX_PROVIDER_ATTENDANCE_APPROVAL_REQUIRED'
          ? 'Aprove o pedido de autoatendimento antes de gerar o Pix.'
          : message === 'LOCAL_PIX_PROVIDER_CUSTOMER_IDENTIFICATION_REQUIRED'
            ? 'Identifique o Cairubido antes de gerar o Pix.'
            : message === 'LOCAL_PIX_PROVIDER_PAYER_EMAIL_REQUIRED'
              ? 'A conta do cliente precisa de um e-mail válido para gerar o Pix.'
              : message === 'LOCAL_PIX_PROVIDER_INTENT_EXPIRED'
                ? 'Este pagamento expirou. Inicie uma nova tentativa.'
                : message === 'LOCAL_PIX_PROVIDER_INTENT_STALE'
                  ? 'O saldo do pedido mudou. Inicie um novo pagamento com o valor atualizado.'
                  : 'O pagamento mudou e precisa ser revisado antes de gerar o Pix.',
    };
  }
  if (
    message === 'LOCAL_PIX_RECOVERY_AMBIGUOUS' ||
    message === 'LOCAL_PIX_RECOVERY_PROVIDER_CONFLICT'
  ) {
    return { status: 409, message: 'O pagamento pendente precisa ser conciliado antes de continuar.' };
  }
  if (
    message === 'MERCADO_PAGO_NOT_CONFIGURED' ||
    message.startsWith('MERCADO_PAGO_API_ERROR:')
  ) {
    return { status: 503, message: 'O Pix do Mercado Pago está temporariamente indisponível.' };
  }
  if (
    message.startsWith('LOCAL_ATTENDANCE_') ||
    message.startsWith('SERVICE_LOCATION_') ||
    message.startsWith('STORE_INSTITUTIONAL_') ||
    message.startsWith('STORE_REPRESENTATION_') ||
    message.startsWith('LOCAL_ORDER_FINANCIAL_') ||
    message.startsWith('LOCAL_PAYMENT_INTENT_') ||
    message.startsWith('LOCAL_PIX_PROVIDER_') ||
    message.startsWith('LOCAL_PIX_RECOVERY_')
  ) {
    console.warn('[Local attendance]', message);
    return { status: 400, message: 'Os dados do atendimento local são inválidos.' };
  }
  console.error('[Local attendance]', error);
  return { status: 503, message: 'O atendimento local está temporariamente indisponível.' };
};

export const createLocalAttendanceRouter = (): Router => {
  const router = Router();

  router.use('/orders', createInPersonOrderRouter());
  router.use('/customers', createInPersonCustomerIdentityRouter());
  router.use('/service-requests', createLocalServiceRequestRouter());

  router.get('/financial-context', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      const orderId = clean(request.query.orderId);
      if (!storeId || !orderId) throw new Error('LOCAL_ORDER_FINANCIAL_SCOPE_REQUIRED');
      await requireStoreAuthority({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      response.status(200).json({
        context: await loadLocalOrderFinancialContext({
          legacyStoreId: storeId,
          orderId,
        }),
      });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.get('/payment-intents/pending-pix', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      const orderId = clean(request.query.orderId);
      if (!storeId || !orderId) throw new Error('LOCAL_PIX_RECOVERY_SCOPE_INVALID');
      const representation = await requireStoreAuthority({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      response.status(200).json({
        attempt: await loadPendingLocalPixAttempt({
          authenticatedUserId: representation.authenticatedUserId,
          storeId,
          orderId,
        }),
      });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.post('/payment-intents', async (request, response) => {
    try {
      const storeId = clean(request.body?.storeId);
      if (!storeId) throw new Error('LOCAL_PAYMENT_INTENT_SCOPE_REQUIRED');
      const representation = await requireStoreAuthority({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      const result = await createLocalPaymentIntent({
        authenticatedUserId: representation.authenticatedUserId,
        value: request.body,
      });
      response.status(result.duplicate ? 200 : 201).json(result);
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.post('/payment-intents/mercado-pago-pix', async (request, response) => {
    try {
      const storeId = clean(request.body?.storeId);
      if (!storeId) throw new Error('LOCAL_PIX_PROVIDER_TARGET_INVALID');
      const representation = await requireStoreAuthority({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      const result = await attachMercadoPagoPixToLocalIntent({
        authenticatedUserId: representation.authenticatedUserId,
        value: request.body,
      });
      response.status(200).json(result);
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.get('/locations', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      if (!storeId) throw new Error('SERVICE_LOCATION_STORE_REQUIRED');
      await requireStoreAuthority({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      response.status(200).json({
        locations: await listServiceLocations({
          storeId,
          activeOnly: request.query.activeOnly === 'true',
        }),
      });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.post('/locations', async (request, response) => {
    try {
      const storeId = clean(request.body?.storeId);
      if (!storeId) throw new Error('SERVICE_LOCATION_STORE_REQUIRED');
      await requireStoreAuthority({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      if (!isServiceLocationKind(request.body?.kind)) {
        throw new Error('SERVICE_LOCATION_KIND_INVALID');
      }
      const location = await createServiceLocation({
        storeId,
        kind: request.body.kind,
        label: request.body?.label,
      });
      response.status(201).json({ location });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.patch('/locations/:locationId', async (request, response) => {
    try {
      const storeId = clean(request.body?.storeId);
      if (!storeId) throw new Error('SERVICE_LOCATION_STORE_REQUIRED');
      await requireStoreAuthority({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      if (
        request.body?.kind !== undefined &&
        !isServiceLocationKind(request.body.kind)
      ) {
        throw new Error('SERVICE_LOCATION_KIND_INVALID');
      }
      if (
        request.body?.active !== undefined &&
        typeof request.body.active !== 'boolean'
      ) {
        throw new Error('SERVICE_LOCATION_ACTIVE_INVALID');
      }
      const location = await updateServiceLocation({
        storeId,
        locationId: clean(request.params.locationId),
        kind: request.body?.kind,
        label: request.body?.label,
        active: request.body?.active,
      });
      response.status(200).json({ location });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.get('/', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      if (!storeId) throw new Error('LOCAL_ATTENDANCE_STORE_REQUIRED');
      await requireStoreAuthority({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      response.status(200).json({
        sessions: await listLocalAttendanceSessions({ storeId }),
      });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.post('/open', async (request, response) => {
    try {
      const storeId = clean(request.body?.storeId);
      if (!storeId) throw new Error('LOCAL_ATTENDANCE_STORE_REQUIRED');
      const representation = await requireStoreAuthority({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      const serviceLocationId = clean(request.body?.serviceLocationId);
      const serviceLocation = serviceLocationId
        ? await getServiceLocation({
            storeId,
            locationId: serviceLocationId,
            requireActive: true,
          })
        : null;
      const session = await openLocalAttendanceSession({
        storeId,
        actorUserId: representation.authenticatedUserId,
        customerLabel: request.body?.customerLabel,
        space: request.body?.space,
        serviceLocation,
        itemCount: request.body?.itemCount,
      });
      response.status(201).json({ session });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.post('/:attendanceId/close', async (request, response) => {
    try {
      const storeId = clean(request.body?.storeId);
      if (!storeId) throw new Error('LOCAL_ATTENDANCE_STORE_REQUIRED');
      const representation = await requireStoreAuthority({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      const session = await closeLocalAttendanceSession({
        storeId,
        attendanceId: clean(request.params.attendanceId),
        actorUserId: representation.authenticatedUserId,
      });
      response.status(200).json({ session });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  return router;
};