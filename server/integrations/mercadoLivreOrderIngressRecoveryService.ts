import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  processMercadoLivreOrderNotificationInboxItem,
  type MercadoLivreOrderIngressResult,
} from './mercadoLivreOrderIngressService.js';

const clean = (value: unknown, maximum = 240): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().slice(0, maximum)
    : '';

const errorCode = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).split(':')[0].slice(0, 120);

const inboxIdFor = (notificationId: string): string =>
  `mercado_livre__${createHash('sha256').update(notificationId).digest('hex')}`;

const orderIdPattern = /^mercado-livre-order-[A-Za-z0-9_-]{3,100}$/;

export interface MercadoLivreOrderIngressRecoveryResult extends MercadoLivreOrderIngressResult {
  recoveryAuthority: 'store_owner_binding_resolution';
  recoveredFromBlock: true;
}

export const retryMercadoLivreOrderIngressAfterBinding = async (input: {
  storeId: string;
  orderId: string;
  requestedByUserId: string;
  now?: Date;
}): Promise<MercadoLivreOrderIngressRecoveryResult> => {
  const storeId = clean(input.storeId, 160);
  const orderId = clean(input.orderId, 180);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  if (!storeId || !requestedByUserId || storeId !== requestedByUserId) {
    throw new Error('STORE_CONNECTION_FORBIDDEN');
  }
  if (!orderIdPattern.test(orderId)) {
    throw new Error('MERCADO_LIVRE_ORDER_RECOVERY_ORDER_ID_INVALID');
  }

  const blockRef = adminDb.doc(
    `stores/${storeId}/mercadoLivreOrderIngressBlocks/${orderId}`
  );
  const blockSnapshot = await blockRef.get();
  if (!blockSnapshot.exists) {
    throw new Error('MERCADO_LIVRE_ORDER_INGRESS_BLOCK_NOT_FOUND');
  }

  const block = blockSnapshot.data() as Record<string, unknown>;
  const sourceNotificationId = clean(block.sourceNotificationId, 200);
  if (
    block.provider !== 'mercado_livre' ||
    clean(block.storeId, 160) !== storeId ||
    clean(block.orderId, 180) !== orderId ||
    !sourceNotificationId
  ) {
    throw new Error('MERCADO_LIVRE_ORDER_INGRESS_BLOCK_INVALID');
  }

  const inboxId = inboxIdFor(sourceNotificationId);
  const inboxRef = adminDb.doc(`integrationWebhookInbox/${inboxId}`);
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const retryLeaseUntil = new Date(now.getTime() + 60_000).toISOString();

  await adminDb.runTransaction(async transaction => {
    const [currentBlockSnapshot, inboxSnapshot] = await Promise.all([
      transaction.get(blockRef),
      transaction.get(inboxRef),
    ]);
    if (!currentBlockSnapshot.exists) {
      throw new Error('MERCADO_LIVRE_ORDER_INGRESS_BLOCK_NOT_FOUND');
    }
    if (!inboxSnapshot.exists) {
      throw new Error('MERCADO_LIVRE_NOTIFICATION_INBOX_NOT_FOUND');
    }

    const currentBlock = currentBlockSnapshot.data() as Record<string, unknown>;
    const inbox = inboxSnapshot.data() as Record<string, unknown>;
    const blockStatus = clean(currentBlock.status, 80);
    const activeLeaseUntil = clean(currentBlock.retryLeaseUntil, 80);
    if (
      blockStatus === 'retrying_after_binding' &&
      activeLeaseUntil &&
      Number.isFinite(Date.parse(activeLeaseUntil)) &&
      Date.parse(activeLeaseUntil) > now.getTime()
    ) {
      throw new Error('MERCADO_LIVRE_ORDER_RECOVERY_ALREADY_IN_PROGRESS');
    }
    if (
      blockStatus !== 'product_binding_required' &&
      blockStatus !== 'retry_failed' &&
      blockStatus !== 'retrying_after_binding'
    ) {
      throw new Error('MERCADO_LIVRE_ORDER_RECOVERY_STATE_INVALID');
    }
    if (
      inbox.provider !== 'mercado_livre' ||
      inbox.topic !== 'orders_v2' ||
      clean(inbox.storeId, 160) !== storeId ||
      clean(inbox.notificationId, 200) !== sourceNotificationId ||
      clean(inbox.orderId, 180) !== orderId
    ) {
      throw new Error('MERCADO_LIVRE_ORDER_RECOVERY_INBOX_MISMATCH');
    }

    const processingStatus = clean(inbox.processingStatus, 40);
    if (processingStatus === 'processed') {
      if (clean(inbox.processingOutcome, 80) !== 'blocked_product_binding') {
        throw new Error('MERCADO_LIVRE_ORDER_RECOVERY_STATE_INVALID');
      }
      transaction.update(inboxRef, {
        processingStatus: 'pending',
        processingOutcome: FieldValue.delete(),
        processingErrorCode: FieldValue.delete(),
        processedAt: FieldValue.delete(),
        failedAt: FieldValue.delete(),
        recoveryAuthority: 'store_owner_binding_resolution',
        recoveryRequestedAt: FieldValue.serverTimestamp(),
        recoveryRequestedByUserId: requestedByUserId,
      });
    } else if (processingStatus !== 'pending') {
      throw new Error('MERCADO_LIVRE_ORDER_RECOVERY_STATE_INVALID');
    }

    transaction.set(blockRef, {
      status: 'retrying_after_binding',
      retryAuthority: 'store_owner_binding_resolution',
      retryRequestedAt: nowIso,
      retryRequestedByUserId: requestedByUserId,
      retryLeaseUntil,
      serverRetryRequestedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  let result: MercadoLivreOrderIngressResult;
  try {
    result = await processMercadoLivreOrderNotificationInboxItem({
      inboxId,
      expectedStoreId: storeId,
    });
  } catch (error) {
    await blockRef.set({
      status: 'retry_failed',
      lastRetryErrorCode: errorCode(error),
      retryLeaseUntil: null,
      lastRetryFailedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    throw error;
  }

  if (result.outcome !== 'blocked_product_binding') {
    await blockRef.set({
      status: 'resolved',
      resolutionAuthority: 'provider_api_refetch_after_store_owner_binding_resolution',
      resolutionOutcome: result.outcome ?? (result.alreadyProcessed ? 'already_processed' : 'processed'),
      retryLeaseUntil: null,
      resolvedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  return {
    ...result,
    recoveryAuthority: 'store_owner_binding_resolution',
    recoveredFromBlock: true,
  };
};
