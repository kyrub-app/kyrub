import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  executeAuthorizedMercadoLivrePublication,
  type MercadoLivrePublicationExecutionResult,
} from './mercadoLivreOutboundPublicationExecutionService.js';

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const executionIdFor = (storeId: string, authorizationId: string): string =>
  `mlexec_${sha256(`${storeId}:${authorizationId}`).slice(0, 32)}`;

const errorCode = (error: unknown): string =>
  error instanceof Error ? error.message.split(':')[0] : 'MERCADO_LIVRE_PUBLICATION_EXECUTION_FAILED';

const proposalAuthorizationId = (input: {
  storeId: string;
  proposalId: string;
  proposal: unknown;
}): string => {
  const proposal = input.proposal && typeof input.proposal === 'object' && !Array.isArray(input.proposal)
    ? input.proposal as Record<string, unknown>
    : {};
  const authorizationId = clean(proposal.publicationAuthorizationId, 180);
  if (
    proposal.schemaVersion !== 2 ||
    clean(proposal.id, 180) !== input.proposalId ||
    clean(proposal.storeId, 160) !== input.storeId ||
    proposal.provider !== 'mercado_livre' ||
    proposal.executionStatus !== 'authorized' ||
    proposal.publicationAuthorizationAuthority !== 'store_owner_publication_authorization' ||
    proposal.publicationAuthorizationSource !== 'kyrubia_explicit_owner_command' ||
    clean(proposal.publicationAuthorizedByUserId, 160) !== input.storeId ||
    !/^mlpub_[a-f0-9]{32}$/i.test(authorizationId)
  ) {
    throw new Error('MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_PROPOSAL_INVALID');
  }
  return authorizationId;
};

const assertKyrubiaExecutionEvidence = (input: {
  storeId: string;
  proposalId: string;
  authorizationId: string;
  authorization: unknown;
  proposal: unknown;
  validation: unknown;
}): void => {
  const authorization = input.authorization && typeof input.authorization === 'object' && !Array.isArray(input.authorization)
    ? input.authorization as Record<string, unknown>
    : {};
  const proposal = input.proposal && typeof input.proposal === 'object' && !Array.isArray(input.proposal)
    ? input.proposal as Record<string, unknown>
    : {};
  const validation = input.validation && typeof input.validation === 'object' && !Array.isArray(input.validation)
    ? input.validation as Record<string, unknown>
    : {};

  if (
    authorization.schemaVersion !== 2 ||
    clean(authorization.id, 180) !== input.authorizationId ||
    clean(authorization.proposalId, 180) !== input.proposalId ||
    clean(authorization.storeId, 160) !== input.storeId ||
    authorization.provider !== 'mercado_livre' ||
    authorization.status !== 'authorized' ||
    authorization.authority !== 'store_owner_publication_authorization' ||
    authorization.authorizationSource !== 'kyrubia_explicit_owner_command' ||
    authorization.listingValidationSource !== 'kyrubia_revalidated_draft' ||
    clean(authorization.authorizedByUserId, 160) !== input.storeId ||
    authorization.consumptionStatus !== 'available' ||
    Number(authorization.useCount) !== 0 ||
    !clean(authorization.listingValidatedAt, 80) ||
    !clean(authorization.payloadHash, 80) ||
    !clean(authorization.tokenHash, 80) ||
    !Number.isFinite(Number(authorization.expiresAtMillis))
  ) {
    throw new Error('MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_AUTHORIZATION_INVALID');
  }

  if (
    proposal.schemaVersion !== 2 ||
    clean(proposal.id, 180) !== input.proposalId ||
    clean(proposal.storeId, 160) !== input.storeId ||
    proposal.provider !== 'mercado_livre' ||
    proposal.executionStatus !== 'authorized' ||
    clean(proposal.publicationAuthorizationId, 180) !== input.authorizationId ||
    proposal.publicationAuthorizationAuthority !== 'store_owner_publication_authorization' ||
    proposal.publicationAuthorizationSource !== 'kyrubia_explicit_owner_command' ||
    clean(proposal.publicationAuthorizedByUserId, 160) !== input.storeId
  ) {
    throw new Error('MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_PROPOSAL_INVALID');
  }

  if (
    validation.schemaVersion !== 2 ||
    clean(validation.proposalId, 180) !== input.proposalId ||
    validation.status !== 'ready_for_owner_authorization' ||
    validation.providerStatus !== 204 ||
    validation.authority !== 'provider_items_validate' ||
    validation.validationSource !== 'kyrubia_revalidated_draft' ||
    clean(validation.validatedAt, 80) !== clean(authorization.listingValidatedAt, 80) ||
    clean(validation.canonicalBaselineHash, 80) !== clean(authorization.canonicalBaselineHash, 80) ||
    clean(validation.providerCapabilityFingerprint, 80) !== clean(authorization.providerCapabilityFingerprint, 80) ||
    validation.providerPublicationModel !== authorization.providerPublicationModel ||
    validation.providerStockAuthority !== authorization.providerStockAuthority ||
    !validation.providerPayload ||
    typeof validation.providerPayload !== 'object' ||
    Array.isArray(validation.providerPayload)
  ) {
    throw new Error('MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_VALIDATION_INVALID');
  }
};

const resetExpiredAuthorizationForRevalidation = async (input: {
  storeId: string;
  proposalId: string;
  authorizationId: string;
}): Promise<boolean> => {
  const authorizationRef = adminDb.doc(
    `stores/${input.storeId}/catalogOutboundPublicationAuthorizations/${input.authorizationId}`
  );
  const proposalRef = adminDb.doc(
    `stores/${input.storeId}/catalogOutboundPublicationProposals/${input.proposalId}`
  );
  const executionId = executionIdFor(input.storeId, input.authorizationId);
  const executionRef = adminDb.doc(
    `stores/${input.storeId}/catalogOutboundPublicationExecutions/${executionId}`
  );

  return adminDb.runTransaction(async transaction => {
    const [authorizationDoc, proposalDoc, executionDoc] = await Promise.all([
      transaction.get(authorizationRef),
      transaction.get(proposalRef),
      transaction.get(executionRef),
    ]);
    if (!authorizationDoc.exists || !proposalDoc.exists || executionDoc.exists) return false;
    const authorization = authorizationDoc.data() as Record<string, unknown>;
    const proposal = proposalDoc.data() as Record<string, unknown>;
    if (
      authorization.authorizationSource !== 'kyrubia_explicit_owner_command' ||
      clean(authorization.proposalId, 180) !== input.proposalId ||
      clean(authorization.storeId, 160) !== input.storeId ||
      clean(authorization.authorizedByUserId, 160) !== input.storeId ||
      authorization.consumptionStatus !== 'available' ||
      Number(authorization.useCount) !== 0 ||
      Number(authorization.expiresAtMillis) > Date.now() ||
      proposal.executionStatus !== 'authorized' ||
      clean(proposal.publicationAuthorizationId, 180) !== input.authorizationId ||
      proposal.publicationAuthorizationSource !== 'kyrubia_explicit_owner_command'
    ) return false;

    const expiredAt = new Date().toISOString();
    transaction.update(authorizationRef, {
      consumptionStatus: 'expired',
      expiredAt,
      serverExpiredAt: FieldValue.serverTimestamp(),
    });
    transaction.update(proposalRef, {
      executionStatus: 'not_authorized',
      publicationReadiness: FieldValue.delete(),
      publicationReadinessAuthority: FieldValue.delete(),
      publicationValidationSource: FieldValue.delete(),
      publicationValidatedAt: FieldValue.delete(),
      publicationAuthorizationId: FieldValue.delete(),
      publicationAuthorizationAuthority: FieldValue.delete(),
      publicationAuthorizationSource: FieldValue.delete(),
      publicationAuthorizedByUserId: FieldValue.delete(),
      publicationAuthorizedAt: FieldValue.delete(),
      serverPublicationAuthorizationExpiredAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
};

const markUnconfirmedReservedExecutionForReconciliation = async (input: {
  storeId: string;
  proposalId: string;
  authorizationId: string;
  executionId: string;
  originalErrorCode: string;
}): Promise<'not_reserved' | 'provider_rejected' | 'reconciliation_required' | 'published'> => {
  const authorizationRef = adminDb.doc(
    `stores/${input.storeId}/catalogOutboundPublicationAuthorizations/${input.authorizationId}`
  );
  const proposalRef = adminDb.doc(
    `stores/${input.storeId}/catalogOutboundPublicationProposals/${input.proposalId}`
  );
  const executionRef = adminDb.doc(
    `stores/${input.storeId}/catalogOutboundPublicationExecutions/${input.executionId}`
  );

  return adminDb.runTransaction(async transaction => {
    const [authorizationDoc, proposalDoc, executionDoc] = await Promise.all([
      transaction.get(authorizationRef),
      transaction.get(proposalRef),
      transaction.get(executionRef),
    ]);
    if (!executionDoc.exists) return 'not_reserved';

    const execution = executionDoc.data() as Record<string, unknown>;
    const executionStatus = clean(execution.status, 80);
    if (executionStatus === 'published') return 'published';
    if (executionStatus === 'provider_rejected') return 'provider_rejected';
    if (executionStatus === 'reconciliation_required') return 'reconciliation_required';
    if (executionStatus !== 'executing') return 'reconciliation_required';

    const authorization = authorizationDoc.data() as Record<string, unknown> | undefined;
    const proposal = proposalDoc.data() as Record<string, unknown> | undefined;
    const reconciledAt = new Date().toISOString();
    transaction.update(executionRef, {
      status: 'reconciliation_required',
      failureCode: 'kyrubia_unconfirmed_after_execution_reservation',
      originalFailureCode: input.originalErrorCode,
      failedAt: reconciledAt,
      serverFailedAt: FieldValue.serverTimestamp(),
    });
    if (authorizationDoc.exists && authorization?.consumptionStatus === 'executing') {
      transaction.update(authorizationRef, {
        consumptionStatus: 'reconciliation_required',
        executionFailedAt: reconciledAt,
        serverExecutionFailedAt: FieldValue.serverTimestamp(),
      });
    }
    if (proposalDoc.exists && proposal?.executionStatus === 'executing') {
      transaction.update(proposalRef, {
        executionStatus: 'reconciliation_required',
        publicationExecutionFailedAt: reconciledAt,
        serverPublicationExecutionFailedAt: FieldValue.serverTimestamp(),
      });
    }
    return 'reconciliation_required';
  });
};

export const executeKyrubiaMercadoLivrePublication = async (input: {
  storeId: string;
  proposalId: string;
  executedByUserId: string;
}): Promise<MercadoLivrePublicationExecutionResult> => {
  const storeId = clean(input.storeId, 160);
  const proposalId = clean(input.proposalId, 180);
  const executedByUserId = clean(input.executedByUserId, 160);
  if (!storeId || !proposalId || executedByUserId !== storeId) {
    throw new Error('MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_TARGET_INVALID');
  }

  const proposalRef = adminDb.doc(
    `stores/${storeId}/catalogOutboundPublicationProposals/${proposalId}`
  );
  const proposalSnapshot = await proposalRef.get();
  if (!proposalSnapshot.exists) {
    throw new Error('MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_PROPOSAL_INVALID');
  }
  const authorizationId = proposalAuthorizationId({
    storeId,
    proposalId,
    proposal: proposalSnapshot.data(),
  });
  const authorizationRef = adminDb.doc(
    `stores/${storeId}/catalogOutboundPublicationAuthorizations/${authorizationId}`
  );
  const validationRef = adminDb.doc(
    `stores/${storeId}/catalogOutboundListingValidations/${proposalId}`
  );

  await adminDb.runTransaction(async transaction => {
    const [authorizationDoc, proposalDoc, validationDoc] = await Promise.all([
      transaction.get(authorizationRef),
      transaction.get(proposalRef),
      transaction.get(validationRef),
    ]);
    if (!authorizationDoc.exists) {
      throw new Error('MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_AUTHORIZATION_INVALID');
    }
    assertKyrubiaExecutionEvidence({
      storeId,
      proposalId,
      authorizationId,
      authorization: authorizationDoc.data(),
      proposal: proposalDoc.data(),
      validation: validationDoc.data(),
    });
  });

  const executionId = executionIdFor(storeId, authorizationId);
  try {
    return await executeAuthorizedMercadoLivrePublication({
      storeId,
      authorizationId,
      executedByUserId,
      expectedAuthorizationSource: 'kyrubia_explicit_owner_command',
      expectedValidationSource: 'kyrubia_revalidated_draft',
      serverExecutionAuthority: 'kyrubia_explicit_publish_now_command',
      expectedProposalId: proposalId,
    });
  } catch (error) {
    const originalErrorCode = errorCode(error);
    if (originalErrorCode === 'MERCADO_LIVRE_PUBLICATION_AUTHORIZATION_EXPIRED') {
      const reset = await resetExpiredAuthorizationForRevalidation({
        storeId,
        proposalId,
        authorizationId,
      });
      if (reset) {
        throw new Error(
          'MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_AUTHORIZATION_EXPIRED_REVALIDATION_REQUIRED'
        );
      }
    }

    const recoveryState = await markUnconfirmedReservedExecutionForReconciliation({
      storeId,
      proposalId,
      authorizationId,
      executionId,
      originalErrorCode,
    });
    if (recoveryState === 'reconciliation_required') {
      throw new Error(
        `MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_RECONCILIATION_REQUIRED:${originalErrorCode}`
      );
    }
    if (recoveryState === 'provider_rejected') {
      throw new Error(
        `MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_PROVIDER_REJECTED:${originalErrorCode}`
      );
    }
    if (recoveryState === 'published') {
      throw new Error(
        `MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_RESULT_ALREADY_PUBLISHED:${originalErrorCode}`
      );
    }
    throw new Error(
      `MERCADO_LIVRE_KYRUBIA_PUBLICATION_EXECUTION_BLOCKED_BEFORE_RESERVATION:${originalErrorCode}`
    );
  }
};
