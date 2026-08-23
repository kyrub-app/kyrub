import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  assertGovernanceDocument,
  assertGovernanceTransition,
  assertVersionedConsentMatchesDocument,
  type GovernanceDocument,
  type GovernanceDocumentStatus,
  type VersionedConsent,
} from '../../shared/governance.js';

const documentPath = (id: string): string => `governanceDocuments/${id}`;
const consentPath = (userId: string, consentId: string): string =>
  `users/${userId}/governanceConsents/${consentId}`;

export const saveGovernanceDocument = async (
  input: GovernanceDocument
): Promise<GovernanceDocument> => {
  const document = assertGovernanceDocument(input);
  await adminDb.doc(documentPath(document.id)).set(
    { ...document, serverUpdatedAt: FieldValue.serverTimestamp() },
    { merge: false }
  );
  return document;
};

export const transitionGovernanceDocument = async (input: {
  documentId: string;
  to: GovernanceDocumentStatus;
  now: string;
}): Promise<GovernanceDocument> => {
  const ref = adminDb.doc(documentPath(input.documentId));
  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error('GOVERNANCE_DOCUMENT_NOT_FOUND');
    const current = assertGovernanceDocument(snapshot.data() as GovernanceDocument);
    assertGovernanceTransition(current.status, input.to);
    const next: GovernanceDocument = {
      ...current,
      status: input.to,
      ...(input.to === 'approved' ? { approvedAt: input.now } : {}),
      ...(input.to === 'published' ? { publishedAt: input.now } : {}),
      ...(input.to === 'superseded' ? { supersededAt: input.now } : {}),
    };
    assertGovernanceDocument(next);
    transaction.set(ref, { ...next, serverUpdatedAt: FieldValue.serverTimestamp() });
    return next;
  });
};

export const recordVersionedConsent = async (input: {
  consent: VersionedConsent;
}): Promise<VersionedConsent> => {
  const documentSnapshot = await adminDb.doc(documentPath(input.consent.documentId)).get();
  if (!documentSnapshot.exists) throw new Error('CONSENT_DOCUMENT_NOT_FOUND');
  const document = assertGovernanceDocument(documentSnapshot.data() as GovernanceDocument);
  const consent = assertVersionedConsentMatchesDocument(input.consent, document);
  await adminDb.doc(consentPath(consent.userId, consent.id)).create({
    ...consent,
    recordedAt: FieldValue.serverTimestamp(),
  });
  return consent;
};

export const listGovernanceDocumentsForAdmin = async (): Promise<GovernanceDocument[]> => {
  const snapshot = await adminDb.collection('governanceDocuments').get();
  return snapshot.docs
    .map(item => assertGovernanceDocument(item.data() as GovernanceDocument))
    .sort((left, right) => left.type.localeCompare(right.type) || right.version.localeCompare(left.version));
};
