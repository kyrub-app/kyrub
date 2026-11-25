import { createHash } from 'node:crypto';
import type { GovernanceDocument } from '../../shared/governance.js';

export type PublicLegalDocument = {
  type: 'terms' | 'privacy'; id: string; version: string; hash: string;
  publishedAt: string; content: string;
};

/** Only trusted repository records may enter this projection. A hash confirms
 * integrity, not legal approval; repository authorization remains mandatory. */
export function projectPublicLegalDocument(
  documents: readonly (GovernanceDocument & {content?: unknown})[],
  type: PublicLegalDocument['type'],
): PublicLegalDocument | null {
  if (type !== 'terms' && type !== 'privacy') return null;
  const current = documents.filter(d => d.type === type && d.status === 'published');
  if (current.length !== 1) return null;
  const d = current[0];
  if (!d.id?.trim() || !d.version?.trim() || !d.approvedAt || !d.publishedAt ||
      !Number.isFinite(Date.parse(d.approvedAt)) || !Number.isFinite(Date.parse(d.publishedAt)) ||
      Date.parse(d.publishedAt) < Date.parse(d.approvedAt) ||
      typeof d.content !== 'string' || !d.content.trim()) return null;
  if (createHash('sha256').update(d.content, 'utf8').digest('hex') !== d.hash) return null;
  return { type, id: d.id, version: d.version, hash: d.hash, publishedAt: d.publishedAt, content: d.content };
}
