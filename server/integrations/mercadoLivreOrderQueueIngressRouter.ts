import { Router } from 'express';
import { parseMercadoLivreNotification } from './mercadoLivreNotificationInboxService.js';
import {
  enqueueMercadoLivreOrderNotification,
  isMercadoLivreOrderQueueTerminalEnvelopeError,
} from './mercadoLivreOrderQueueService.js';

const errorCode = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).split(':')[0].slice(0, 100);

const isNonRetryableNotificationError = (code: string): boolean =>
  (code.startsWith('MERCADO_LIVRE_NOTIFICATION_') &&
    (code.endsWith('_INVALID') || code === 'MERCADO_LIVRE_NOTIFICATION_INVALID')) ||
  isMercadoLivreOrderQueueTerminalEnvelopeError(code);

export const createMercadoLivreOrderQueueIngressRouter = (): Router => {
  const router = Router();

  router.post('/notifications', async (request, response, next) => {
    let notification;
    try {
      notification = parseMercadoLivreNotification(request.body);
    } catch (error) {
      const code = errorCode(error);
      if (isNonRetryableNotificationError(code)) {
        response.status(200).json({ received: true, ignored: true, code });
        return;
      }
      next(error);
      return;
    }

    if (notification.topic !== 'orders_v2') {
      next();
      return;
    }

    try {
      const queued = await enqueueMercadoLivreOrderNotification(request.body);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.status(200).json({
        received: true,
        queued: true,
        notificationId: queued.notificationId,
      });
    } catch (error) {
      const code = errorCode(error);
      if (isNonRetryableNotificationError(code)) {
        console.warn('[Mercado Livre orders_v2 ignored]', code);
        response.status(200).json({ received: true, ignored: true, code });
        return;
      }
      console.error('[Mercado Livre orders_v2 queue]', code);
      response.status(503).json({ received: false });
    }
  });

  return router;
};
