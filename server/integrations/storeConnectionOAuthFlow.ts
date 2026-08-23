import { createHash, randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  assertStoreOAuthFlow,
  type StoreOAuthAuthorizationFlow,
} from '../../shared/storeConnectionOAuth.js';

const FLOW_TTL_MS = 10 * 60 * 1000;
const flowPath = (flowId: string): string => `storeConnectionOAuthFlows/${flowId}`;
const hashState = (state: string): string => createHash('sha256').update(state).digest('hex');

export const createStoreOAuthAuthorizationFlow = async (input: {
  storeId: string;
  provider: string;
  requestedByUserId: string;
  now?: Date;
}): Promise<{ flow: StoreOAuthAuthorizationFlow; state: string }> => {
  const now = input.now ?? new Date();
  const state = randomBytes(32).toString('base64url');
  const flowId = `oauth_${randomBytes(18).toString('base64url')}`;
  const flow = assertStoreOAuthFlow({
    id: flowId,
    storeId: input.storeId,
    provider: input.provider,
    requestedByUserId: input.requestedByUserId,
    status: 'created',
    stateHash: hashState(state),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + FLOW_TTL_MS).toISOString(),
  });
  await adminDb.doc(flowPath(flowId)).create({
    ...flow,
    createdAtServer: FieldValue.serverTimestamp(),
  });
  return { flow, state };
};

export const consumeStoreOAuthCallbackState = async (input: {
  flowId: string;
  state: string;
  now?: Date;
}): Promise<StoreOAuthAuthorizationFlow> => {
  const now = input.now ?? new Date();
  const ref = adminDb.doc(flowPath(input.flowId));
  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error('STORE_OAUTH_FLOW_NOT_FOUND');
    const flow = assertStoreOAuthFlow(snapshot.data() as StoreOAuthAuthorizationFlow);
    if (flow.status !== 'created' && flow.status !== 'redirected') {
      throw new Error('STORE_OAUTH_FLOW_ALREADY_CONSUMED');
    }
    if (Date.parse(flow.expiresAt) <= now.getTime()) {
      transaction.update(ref, { status: 'expired', completedAt: now.toISOString() });
      throw new Error('STORE_OAUTH_FLOW_EXPIRED');
    }
    if (hashState(input.state) !== flow.stateHash) {
      throw new Error('STORE_OAUTH_STATE_MISMATCH');
    }
    const next: StoreOAuthAuthorizationFlow = {
      ...flow,
      status: 'callback_received',
      completedAt: now.toISOString(),
    };
    transaction.update(ref, next);
    return next;
  });
};
