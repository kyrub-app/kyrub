import { projectPublicLegalDocument, type PublicLegalDocument } from './publicLegalDocumentPolicy.js';
import type { GovernanceDocument } from '../../shared/governance.js';

/** Explicit legal publication gate, disabled by default. No draft fallback. */
export async function readPublicLegalDocument(type: PublicLegalDocument['type']): Promise<PublicLegalDocument | null> {
  if (type !== 'terms' && type !== 'privacy') return null;
  if (process.env.KYRUB_PUBLIC_LEGAL_DOCUMENTS_ENABLED !== 'true') return null;
  const { adminDb } = await import('../firebaseAdmin.js');
  const snapshot = await adminDb.collection('governanceDocuments')
    .where('type', '==', type).where('status', '==', 'published').limit(2).get();
  if (snapshot.size !== 1) return null;
  const record = snapshot.docs[0];
  const data = record.data() as GovernanceDocument & {content?: unknown};
  if (data.id !== record.id || typeof data.publishedAt !== 'string' ||
      Date.parse(data.publishedAt) > Date.now()) return null;
  return projectPublicLegalDocument([data], type);
}
