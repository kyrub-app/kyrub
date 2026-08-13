import { adminDb } from './firebaseAdmin.js';

export type KyrubiaAiUsageOperation =
  | 'conversation_text'
  | 'conversation_multimodal_simple'
  | 'conversation_multimodal_complex'
  | 'erp_read_followup';

export type KyrubiaAiUsageRoute = 'primary' | 'economy' | 'followup';

export type RecordKyrubiaAiUsageInput = {
  uid: string;
  requestId: string;
  callIndex: number;
  operation: KyrubiaAiUsageOperation;
  model: string;
  route: KyrubiaAiUsageRoute;
  fallbackUsed: boolean;
  payload: Record<string, unknown>;
};

export const kyrubiaUsageMeteringDb = adminDb;
