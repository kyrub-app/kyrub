import { confirmMonthlyPresence, firestoreMonthlyPresenceStore, type MonthlyPresenceStore } from './monthlyPresence.js';
import { adminDb, getFirebaseAdminProjectId } from '../firebaseAdmin.js';

export type PresenceReply = { status: 'confirmed' | 'not_qualified' | 'disabled' | 'unavailable'; month?: string };
type Env = Record<string, string | undefined>;

// This candidate is intentionally incapable of writing to a remote project.
// No production flag or credential is created by this change.
export function resolveMonthlyPresenceEmulatorConfig(env: Env) {
  if (env.KYRUB_FINOPS_MAU_EMULATOR_ENABLED !== 'true' ||
      env.VERCEL_ENV === 'production' || env.NODE_ENV === 'production' ||
      env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8088' ||
      env.FIREBASE_PROJECT_ID !== 'kyrub-security-test' ||
      env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() ||
      !/^[a-fA-F0-9]{64}$/.test(env.KYRUB_FINOPS_MAU_EMULATOR_KEY ?? '')) return null;
  return {projectId:'kyrub-security-test', secret:Buffer.from(env.KYRUB_FINOPS_MAU_EMULATOR_KEY!, 'hex')};
}

export function isQualifyingMonthlyPresenceEvent(event: {
  type: string; domain: string; source: string; authority: string;
  screenId?: string; entityId?: string;
}): boolean {
  // Behavioral evidence only, not proof of a human action or a financial fact.
  return ['navigation.screen_viewed','navigation.community_opened'].includes(event.type) &&
    ['app','community','store','catalog','order','reservation'].includes(event.domain) &&
    event.source === 'client_observation' && event.authority === 'context_only' &&
    Boolean(event.screenId || (event.type === 'navigation.community_opened' && event.entityId));
}

type Dependencies = {
  env: Env;
  currentProject: () => string;
  store: () => MonthlyPresenceStore;
};

export async function confirmTransportMonthlyPresence(
  uid: string, requested: boolean, qualified: boolean, receivedAt: Date,
  deps: Dependencies = {
    env: process.env,
    currentProject: getFirebaseAdminProjectId,
    store: () => firestoreMonthlyPresenceStore(adminDb),
  },
): Promise<PresenceReply | undefined> {
  if (!requested) return undefined;
  const config = resolveMonthlyPresenceEmulatorConfig(deps.env);
  if (!config) return {status:'disabled'};
  if (!qualified) return {status:'not_qualified'};
  try {
    if (deps.currentProject() !== config.projectId) return {status:'disabled'};
    const result = await confirmMonthlyPresence({
      authenticatedUid:uid, projectId:config.projectId, qualifiedActivity:true, receivedAt,
    }, config.secret, deps.store());
    return {status:'confirmed', month:result.month};
  } catch {
    // Telemetry failure must not turn an accepted activity batch into a retry loop.
    return {status:'unavailable'};
  }
}
