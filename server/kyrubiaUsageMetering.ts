import { FieldValue } from 'firebase-admin/firestore';
import type {
  KyrubiaAiFundingSource,
  KyrubiaAiProviderId,
} from '../shared/kyrubiaAiRouting.js';
import {
  estimateGeminiUsageCost,
  parseGeminiUsageMetadata,
  type KyrubiaUsageSnapshot,
} from '../shared/kyrubiaUsageMetering.js';
import { adminDb } from './firebaseAdmin.js';

export type KyrubiaAiUsageOperation =
  | 'conversation_text'
  | 'conversation_multimodal_simple'
  | 'conversation_multimodal_complex'
  | 'catalog_analysis'
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
  provider?: KyrubiaAiProviderId;
  fundingSource?: KyrubiaAiFundingSource;
};

export type RecordKyrubiaAiUsageResult = {
  recorded: boolean;
  replay: boolean;
  usage: KyrubiaUsageSnapshot | null;
  estimatedCostMicrousd: number | null;
  pricingStatus: string;
};

const safeIdentifier = (value: string, maximum = 160): string =>
  value.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, maximum);

const isAlreadyExistsError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === 6 ||
    candidate.code === 'already-exists' ||
    (typeof candidate.message === 'string' && /already exists/i.test(candidate.message));
};

export const recordKyrubiaAiUsage = async (
  input: RecordKyrubiaAiUsageInput
): Promise<RecordKyrubiaAiUsageResult> => {
  const uid = safeIdentifier(input.uid, 128);
  const requestId = safeIdentifier(input.requestId, 160);
  const model = input.model.trim().slice(0, 120);
  const usage = parseGeminiUsageMetadata(input.payload);

  if (!uid || !requestId || !model || !usage) {
    return {
      recorded: false,
      replay: false,
      usage,
      estimatedCostMicrousd: null,
      pricingStatus: usage ? 'invalid_identity' : 'usage_metadata_missing',
    };
  }

  const callIndex = Number.isSafeInteger(input.callIndex) && input.callIndex > 0
    ? input.callIndex
    : 1;
  const effectiveRoute: KyrubiaAiUsageRoute =
    input.fallbackUsed === true && input.route === 'primary'
      ? 'economy'
      : input.route;
  const provider = input.provider ?? 'google-gemini';
  const fundingSource = input.fundingSource ?? 'platform_legacy';
  const baseCost = estimateGeminiUsageCost(model, usage);
  const hasSeparateToolUse = usage.toolUsePromptTokenCount > 0;
  const cost = hasSeparateToolUse
    ? {
        pricing: baseCost.pricing,
        pricingStatus: 'tool_use_unpriced',
        estimatedCostMicrousd: null,
      }
    : baseCost;
  const eventId = `${requestId}_${callIndex}`;
  const priced = cost.estimatedCostMicrousd !== null;

  try {
    await adminDb.collection('kyrub_usage_events').doc(eventId).create({
      schemaVersion: 2,
      id: eventId,
      uid,
      resource: 'ai',
      provider,
      fundingSource,
      requestId,
      callIndex,
      operation: input.operation,
      model,
      route: effectiveRoute,
      fallbackUsed: input.fallbackUsed === true,
      promptTokenCount: usage.promptTokenCount,
      cachedContentTokenCount: usage.cachedContentTokenCount,
      candidatesTokenCount: usage.candidatesTokenCount,
      toolUsePromptTokenCount: usage.toolUsePromptTokenCount,
      thoughtsTokenCount: usage.thoughtsTokenCount,
      totalTokenCount: usage.totalTokenCount,
      promptTokensDetails: usage.promptTokensDetails,
      cacheTokensDetails: usage.cacheTokensDetails,
      candidatesTokensDetails: usage.candidatesTokensDetails,
      toolUsePromptTokensDetails: usage.toolUsePromptTokensDetails,
      serviceTier: usage.serviceTier,
      pricing: cost.pricing,
      pricingStatus: cost.pricingStatus,
      pricedCallCount: priced ? 1 : 0,
      unpricedCallCount: priced ? 0 : 1,
      estimatedCostMicrousd: cost.estimatedCostMicrousd,
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      recorded: true,
      replay: false,
      usage,
      estimatedCostMicrousd: cost.estimatedCostMicrousd,
      pricingStatus: cost.pricingStatus,
    };
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      return {
        recorded: false,
        replay: true,
        usage,
        estimatedCostMicrousd: cost.estimatedCostMicrousd,
        pricingStatus: cost.pricingStatus,
      };
    }
    throw error;
  }
};
