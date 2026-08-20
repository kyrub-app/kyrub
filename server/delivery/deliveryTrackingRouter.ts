import { Router, type Request, type Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '../firebaseAdmin';

const DELIVERY_COLLECTION = 'hub/renda/deliveries';
const DELIVERY_CLAIM_COLLECTION = 'deliveryClaims';
const DELIVERY_TRACKING_COLLECTION = 'deliveryTracking';

const bearerToken = (request: Request): string => {
  const authorization = request.get('authorization') ?? '';
  return /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';
};

const authenticatedCourierId = async (request: Request): Promise<string> => {
  const token = bearerToken(request);
  if (!token) throw new Error('AUTH_REQUIRED');
  return (await adminAuth.verifyIdToken(token, true)).uid;
};

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const validateDeliveryId = (value: string): string => {
  const deliveryId = value.trim();
  if (!deliveryId || !/^[a-zA-Z0-9_-]{1,128}$/.test(deliveryId)) {
    throw new Error('A entrega não foi identificada.');
  }
  return deliveryId;
};

const parseLocation = (value: unknown): {
  latitude: number;
  longitude: number;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  clientCapturedAt: number;
} => {
  const candidate = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const latitude = finite(candidate.latitude);
  const longitude = finite(candidate.longitude);
  const accuracy = finite(candidate.accuracy);
  const heading = finite(candidate.heading);
  const speed = finite(candidate.speed);
  const clientCapturedAt = finite(candidate.clientCapturedAt) ?? Date.now();

  if (latitude === null || latitude < -90 || latitude > 90) {
    throw new Error('Latitude inválida.');
  }
  if (longitude === null || longitude < -180 || longitude > 180) {
    throw new Error('Longitude inválida.');
  }
  if (accuracy === null || accuracy < 0 || accuracy > 100_000) {
    throw new Error('Precisão da localização inválida.');
  }

  return {
    latitude,
    longitude,
    accuracy,
    heading,
    speed,
    clientCapturedAt,
  };
};

const errorResponse = (response: Response, error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED' || /id-token|expired|revoked/i.test(message)) {
    response.status(401).json({ error: 'Faça login novamente.' });
    return;
  }
  if (/não identificada|inválid/i.test(message)) {
    response.status(400).json({ error: message });
    return;
  }
  if (/não encontrada|não é o responsável|não está em andamento/i.test(message)) {
    response.status(409).json({ error: message });
    return;
  }
  console.error('[Courier Tracking]', error);
  response.status(503).json({
    error: 'Não foi possível atualizar o rastreio desta entrega.',
  });
};

export const createDeliveryTrackingRouter = (): Router => {
  const router = Router();

  router.post('/:deliveryId/location', async (request, response) => {
    try {
      const courierId = await authenticatedCourierId(request);
      const deliveryId = validateDeliveryId(request.params.deliveryId);
      const location = parseLocation(request.body);
      const deliveryReference = adminDb.doc(`${DELIVERY_COLLECTION}/${deliveryId}`);
      const claimReference = adminDb.doc(`${DELIVERY_CLAIM_COLLECTION}/${deliveryId}`);
      const trackingReference = adminDb.doc(`${DELIVERY_TRACKING_COLLECTION}/${deliveryId}`);

      await adminDb.runTransaction(async transaction => {
        const [deliverySnapshot, claimSnapshot] = await Promise.all([
          transaction.get(deliveryReference),
          transaction.get(claimReference),
        ]);
        if (!deliverySnapshot.exists || !claimSnapshot.exists) {
          throw new Error('A entrega não foi encontrada.');
        }
        const delivery = deliverySnapshot.data() as Record<string, unknown>;
        const claim = claimSnapshot.data() as Record<string, unknown>;
        if (clean(claim.courierId) !== courierId) {
          throw new Error('Este entregador não é o responsável pela corrida.');
        }
        if (!['accepted', 'delivering'].includes(clean(delivery.status))) {
          throw new Error('Esta entrega não está em andamento.');
        }

        transaction.set(
          trackingReference,
          {
            deliveryId,
            courierId,
            storeId: clean(delivery.storeId),
            sourceOrderId: clean(delivery.sourceOrderId),
            active: true,
            ...location,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });

      response.status(204).end();
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/:deliveryId/stop', async (request, response) => {
    try {
      const courierId = await authenticatedCourierId(request);
      const deliveryId = validateDeliveryId(request.params.deliveryId);
      const claimSnapshot = await adminDb
        .doc(`${DELIVERY_CLAIM_COLLECTION}/${deliveryId}`)
        .get();
      if (!claimSnapshot.exists) throw new Error('A entrega não foi encontrada.');
      const claim = claimSnapshot.data() as Record<string, unknown>;
      if (clean(claim.courierId) !== courierId) {
        throw new Error('Este entregador não é o responsável pela corrida.');
      }
      await adminDb.doc(`${DELIVERY_TRACKING_COLLECTION}/${deliveryId}`).set(
        {
          deliveryId,
          courierId,
          active: false,
          endedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      response.status(204).end();
    } catch (error) {
      errorResponse(response, error);
    }
  });

  return router;
};
