import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall } from 'firebase-functions/v2/https';
import { recordAuthoritativeAdminAudit } from './admin/audit';
import { requireActiveAdmin } from './admin/auth';
import { toAdminHttpsError } from './admin/errors';
import { enforceAdminRateLimit } from './admin/rateLimit';
import { parseAdminStatusRequest } from './admin/request';

initializeApp();

setGlobalOptions({
  region: 'southamerica-east1',
  memory: '256MiB',
  timeoutSeconds: 30,
  minInstances: 0,
  maxInstances: 10,
  concurrency: 20,
});

const firestore = getFirestore();

export const adminPrivilegedStatus = onCall(async request => {
  try {
    const payload = parseAdminStatusRequest(request.data);
    const principal = await requireActiveAdmin(
      firestore,
      request,
      'read_overview'
    );
    const rateLimit = await enforceAdminRateLimit(
      firestore,
      principal.uid,
      'admin.backend.status.checked',
      { maximum: 30, windowMs: 60_000 }
    );
    const audit = await recordAuthoritativeAdminAudit(firestore, {
      requestId: payload.requestId,
      action: 'admin.backend.status.checked',
      actor: principal,
      targetType: 'control_plane',
      targetId: 'admin_backend',
      outcome: 'success',
    });

    return {
      ok: true,
      requestId: payload.requestId,
      role: principal.role,
      permissions: principal.permissions,
      backend: {
        state: 'foundation',
        mutationsEnabled: false,
        authoritativeAudit: true,
      },
      rateLimit: {
        remaining: rateLimit.remaining,
      },
      audit: {
        replayed: audit.replayed,
      },
      serverTime: new Date().toISOString(),
    };
  } catch (error) {
    logger.warn('Privileged admin status request rejected.', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      authenticated: Boolean(request.auth?.uid),
    });
    throw toAdminHttpsError(error);
  }
});
