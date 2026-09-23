import express from 'express';
import { adminAuth } from '../firebaseAdmin.js';
import { prepareFiscalHomologationAttempt } from './fiscalHomologationAttemptLedger.js';
import { prepareFiscalExecutableDocumentSnapshot } from './fiscalExecutableDocumentSnapshotService.js';
import { bindFiscalTaxExecutionPolicyToAttempt } from './fiscalExecutableDocumentTaxBindingService.js';
import {
  executePreparedFiscalHomologationAttempt,
  reconcileFiscalHomologationAttempt,
} from './fiscalProviderExecutionService.js';

const router = express.Router();
router.use(express.json({ limit: '64kb' }));

const ORDER_ID_PATTERN = /^[a-zA-Z0-9:_-]{1,240}$/;
const ATTEMPT_ID_PATTERN = /^fiscal-attempt-[a-f0-9]{48}$/;

const clean = (value: unknown, maxLength = 240): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const bearer = (value: unknown): string => {
  const text = clean(value, 4096);
  return text.startsWith('Bearer ') ? text.slice(7).trim() : '';
};

const authenticateOwner = async (
  request: express.Request,
  storeId: string
): Promise<{ uid: string }> => {
  const token = bearer(request.headers.authorization);
  if (!token) throw new Error('FISCAL_HOMOLOGATION_AUTH_REQUIRED');
  const identity = await adminAuth.verifyIdToken(token);
  if (!identity.uid || identity.uid !== storeId) {
    throw new Error('FISCAL_HOMOLOGATION_FORBIDDEN');
  }
  return { uid: identity.uid };
};

const statusForError = (error: unknown): number => {
  const code = error instanceof Error ? error.message : '';
  if (code.includes('AUTH_REQUIRED')) return 401;
  if (code.includes('FORBIDDEN')) return 403;
  if (
    code.includes('INVALID') ||
    code.includes('REQUIRED') ||
    code.includes('NOT_READY') ||
    code.includes('NOT_PREPARED') ||
    code.includes('NOT_ALLOWED') ||
    code.includes('UNSUPPORTED') ||
    code.includes('MISMATCH') ||
    code.includes('STALE') ||
    code.includes('INCOMPLETE')
  ) return 409;
  if (code.includes('NOT_FOUND')) return 404;
  return 500;
};

const safeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : 'FISCAL_HOMOLOGATION_FAILED';
  return /^[A-Z0-9_]+$/.test(message) ? message : 'FISCAL_HOMOLOGATION_FAILED';
};

router.post('/:storeId/orders/:orderId/prepare', async (request, response) => {
  try {
    const storeId = clean(request.params.storeId, 160);
    const orderId = clean(request.params.orderId, 240);
    if (!storeId || !ORDER_ID_PATTERN.test(orderId)) {
      return response.status(400).json({ error: 'FISCAL_HOMOLOGATION_REQUEST_INVALID' });
    }
    const identity = await authenticateOwner(request, storeId);

    const preparedAttempt = await prepareFiscalHomologationAttempt({
      tenantId: identity.uid,
      requestedByUserId: identity.uid,
      orderId,
    });
    const sourceSnapshot = await prepareFiscalExecutableDocumentSnapshot({
      tenantId: identity.uid,
      requestedByUserId: identity.uid,
      attemptId: preparedAttempt.attempt.attemptId,
    });
    const readyBinding = await bindFiscalTaxExecutionPolicyToAttempt({
      tenantId: identity.uid,
      requestedByUserId: identity.uid,
      attemptId: preparedAttempt.attempt.attemptId,
    });

    return response.status(200).json({
      schemaVersion: 1,
      action: 'prepared_for_homologation',
      environment: 'sandbox',
      providerCallMade: false,
      sefazCallMade: false,
      attempt: {
        attemptId: preparedAttempt.attempt.attemptId,
        reused: preparedAttempt.reused,
        orderId: preparedAttempt.attempt.orderId,
        documentFamily: preparedAttempt.attempt.policy.documentFamily,
        structuralPolicy: {
          policyId: preparedAttempt.attempt.policy.policyId,
          version: preparedAttempt.attempt.policy.version,
          policyReference: preparedAttempt.attempt.policy.policyReference,
        },
        fiscalDocument: {
          sourceSnapshotId: sourceSnapshot.snapshot.snapshotId,
          readySnapshotId: readyBinding.snapshot.snapshotId,
          status: readyBinding.snapshot.status,
        },
        taxPolicy: readyBinding.policy,
        state: 'prepared',
      },
    });
  } catch (error) {
    return response.status(statusForError(error)).json({ error: safeError(error) });
  }
});

router.post('/:storeId/attempts/:attemptId/execute', async (request, response) => {
  try {
    const storeId = clean(request.params.storeId, 160);
    const attemptId = clean(request.params.attemptId, 160);
    if (!storeId || !ATTEMPT_ID_PATTERN.test(attemptId)) {
      return response.status(400).json({ error: 'FISCAL_HOMOLOGATION_REQUEST_INVALID' });
    }
    const identity = await authenticateOwner(request, storeId);
    const result = await executePreparedFiscalHomologationAttempt({
      tenantId: identity.uid,
      requestedByUserId: identity.uid,
      attemptId,
    });
    return response.status(200).json({
      schemaVersion: 1,
      action: 'homologation_execution',
      environment: 'sandbox',
      attempt: {
        attemptId: result.attempt.attemptId,
        orderId: result.attempt.orderId,
        state: result.attempt.state,
        externalRequestId: result.attempt.externalRequestId,
        providerStatus: result.attempt.providerStatus,
        providerCode: result.attempt.providerCode,
        providerMessage: result.attempt.providerMessage,
        authorizationProtocol: result.attempt.authorizationProtocol,
        accessKey: result.attempt.accessKey,
        documentNumber: result.attempt.documentNumber,
        submittedAt: result.attempt.submittedAt,
        lastCheckedAt: result.attempt.lastCheckedAt,
      },
    });
  } catch (error) {
    return response.status(statusForError(error)).json({ error: safeError(error) });
  }
});

router.post('/:storeId/attempts/:attemptId/reconcile', async (request, response) => {
  try {
    const storeId = clean(request.params.storeId, 160);
    const attemptId = clean(request.params.attemptId, 160);
    if (!storeId || !ATTEMPT_ID_PATTERN.test(attemptId)) {
      return response.status(400).json({ error: 'FISCAL_HOMOLOGATION_REQUEST_INVALID' });
    }
    const identity = await authenticateOwner(request, storeId);
    const result = await reconcileFiscalHomologationAttempt({
      tenantId: identity.uid,
      requestedByUserId: identity.uid,
      attemptId,
    });
    return response.status(200).json({
      schemaVersion: 1,
      action: 'homologation_reconciliation',
      environment: 'sandbox',
      resubmitted: false,
      attempt: {
        attemptId: result.attempt.attemptId,
        orderId: result.attempt.orderId,
        state: result.attempt.state,
        externalRequestId: result.attempt.externalRequestId,
        providerStatus: result.attempt.providerStatus,
        providerCode: result.attempt.providerCode,
        providerMessage: result.attempt.providerMessage,
        authorizationProtocol: result.attempt.authorizationProtocol,
        accessKey: result.attempt.accessKey,
        documentNumber: result.attempt.documentNumber,
        submittedAt: result.attempt.submittedAt,
        lastCheckedAt: result.attempt.lastCheckedAt,
      },
    });
  } catch (error) {
    return response.status(statusForError(error)).json({ error: safeError(error) });
  }
});

export const createFiscalHomologationOrchestratorRouter = (): express.Router => router;
