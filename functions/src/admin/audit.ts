import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { AdminPrincipal } from './contracts';
import { isSafeOperationIdentifier } from './request';

export type AdminBackendAuditAction = 'admin.backend.status.checked';

export interface AdminBackendAuditInput {
  requestId: string;
  action: AdminBackendAuditAction;
  actor: AdminPrincipal;
  targetType: 'control_plane';
  targetId: 'admin_backend';
  outcome: 'success' | 'denied' | 'failed';
}

export class AdminAuditConflictError extends Error {
  constructor() {
    super('O requestId já foi utilizado em outra operação administrativa.');
    this.name = 'AdminAuditConflictError';
  }
}

export const buildAdminBackendAuditData = (
  input: AdminBackendAuditInput
): Record<string, unknown> => {
  if (!isSafeOperationIdentifier(input.requestId)) {
    throw new Error('requestId inválido para auditoria administrativa.');
  }

  return {
    id: `backend_${input.requestId}`,
    requestId: input.requestId,
    action: input.action,
    actorId: input.actor.uid,
    actorRole: input.actor.role,
    targetType: input.targetType,
    targetId: input.targetId,
    source: 'backend',
    outcome: input.outcome,
    createdAt: FieldValue.serverTimestamp(),
  };
};

export const recordAuthoritativeAdminAudit = async (
  firestore: Firestore,
  input: AdminBackendAuditInput
): Promise<{ replayed: boolean }> => {
  const data = buildAdminBackendAuditData(input);
  const auditId = String(data.id);
  const reference = firestore.doc(
    `kyrub_admin/control_plane/audit_logs/${auditId}`
  );

  return firestore.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (snapshot.exists) {
      const existing = snapshot.data();
      if (
        existing?.requestId === input.requestId &&
        existing?.action === input.action &&
        existing?.actorId === input.actor.uid
      ) {
        return { replayed: true };
      }
      throw new AdminAuditConflictError();
    }

    transaction.create(reference, data);
    return { replayed: false };
  });
};
