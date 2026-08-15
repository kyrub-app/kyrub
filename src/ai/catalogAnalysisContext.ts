import type { KyrubAiConsultantRequest } from '../../shared/aiConsultant';
import { loadKyrubiaCatalogAnalysis } from './catalogAnalysisStore';

/**
 * Rehydrates the latest structured catalog analysis for exactly one authenticated
 * UID + conversation pair. The returned context is conversational memory only;
 * it never grants mutation authority or proves that a write occurred.
 */
export const prepareKyrubAiCatalogAnalysisContext = (
  payload: KyrubAiConsultantRequest,
  storage: Storage | undefined,
  uid: string
): KyrubAiConsultantRequest => {
  if (payload.catalogAnalysisContext || !storage || !uid || !payload.conversationId) {
    return payload;
  }

  const analysis = loadKyrubiaCatalogAnalysis(
    storage,
    uid,
    payload.conversationId
  );

  return analysis
    ? { ...payload, catalogAnalysisContext: analysis }
    : payload;
};
