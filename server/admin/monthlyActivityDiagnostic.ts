import type { Firestore } from 'firebase-admin/firestore';
import type { AdminMonthlyActivityDiagnostic } from '../../shared/adminPlatformEconomy.js';
import { adminDb, getFirebaseAdminProjectId } from '../firebaseAdmin.js';
import { presenceMonth } from '../observability/monthlyPresence.js';
import { resolveMonthlyPresenceEmulatorConfig } from '../observability/monthlyPresenceTransport.js';

type Dependencies = {
  env: Record<string,string|undefined>;
  currentProject: () => string;
  count: (month: string) => Promise<number>;
};
export async function countMonthlyPresenceMarkers(db: Pick<Firestore,'collection'>, month: string): Promise<number> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('MAU_INVALID_MONTH');
  const snapshot = await db.collection('kyrub_finops_mau_months/' + month + '/markers').count().get();
  const count = snapshot.data().count;
  if (!Number.isSafeInteger(count) || count < 0) throw Error('MAU_INVALID_COUNT');
  return count;
}

// Only the authorized economy endpoint calls this diagnostic. It never
// returns document identities, and fixture counts never attest real MAU.
export async function loadMonthlyActivityDiagnostic(
  now = new Date(),
  deps: Dependencies = {
    env:process.env,
    currentProject:getFirebaseAdminProjectId,
    count:month=>countMonthlyPresenceMarkers(adminDb,month),
  },
): Promise<AdminMonthlyActivityDiagnostic> {
  const month = presenceMonth(now);
  const unavailable = {month, scope:'emulator_only' as const, status:'unavailable' as const, observedMarkers:null, realMau:null};
  const config = resolveMonthlyPresenceEmulatorConfig(deps.env);
  if (!config) return unavailable;
  try {
    if (deps.currentProject() !== config.projectId) return unavailable;
    const count = await deps.count(month);
    if (!Number.isSafeInteger(count) || count < 0) return unavailable;
    return {month,scope:'emulator_only',status:'fixture_count',observedMarkers:count,realMau:null};
  } catch {
    return unavailable;
  }
}
