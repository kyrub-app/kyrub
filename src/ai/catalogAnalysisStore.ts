import type { KyrubCatalogAnalysis } from '../../shared/kyrubCatalogAnalysis';
import { normalizeKyrubCatalogAnalysis } from '../../shared/kyrubCatalogAnalysis';

const STORAGE_PREFIX = 'kyrub_catalog_analysis_v1';

const storageKey = (uid: string, conversationId: string): string =>
  `${STORAGE_PREFIX}:${uid}:${conversationId}`;

export const saveKyrubiaCatalogAnalysis = (
  storage: Storage,
  uid: string,
  conversationId: string,
  analysis: KyrubCatalogAnalysis
): void => {
  if (!uid || !conversationId) return;
  const normalized = normalizeKyrubCatalogAnalysis(analysis, {
    sourceKind: analysis.sourceKind,
    attachmentCount: analysis.attachmentCount,
  });
  if (!normalized) return;
  storage.setItem(storageKey(uid, conversationId), JSON.stringify({
    savedAt: new Date().toISOString(),
    analysis: normalized,
  }));
};

export const loadKyrubiaCatalogAnalysis = (
  storage: Storage,
  uid: string,
  conversationId: string
): KyrubCatalogAnalysis | undefined => {
  if (!uid || !conversationId) return undefined;
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(uid, conversationId)) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const candidate = parsed as Record<string, unknown>;
    const raw = candidate.analysis;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const record = raw as Record<string, unknown>;
    const normalized = normalizeKyrubCatalogAnalysis(raw, {
      sourceKind: record.sourceKind === 'multimodal' ? 'multimodal' : 'text',
      attachmentCount: typeof record.attachmentCount === 'number'
        ? record.attachmentCount
        : 0,
    });
    return normalized ?? undefined;
  } catch {
    return undefined;
  }
};

export const clearKyrubiaCatalogAnalysis = (
  storage: Storage,
  uid: string,
  conversationId: string
): void => {
  if (!uid || !conversationId) return;
  storage.removeItem(storageKey(uid, conversationId));
};
