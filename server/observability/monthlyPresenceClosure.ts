import type { Firestore } from 'firebase-admin/firestore';
import { presenceMonth } from './monthlyPresence.js';

type ClosureDb = Pick<Firestore,'doc'|'collection'|'runTransaction'>;
export type MonthlyFixtureSummary = {
  schemaVersion: 1;
  projectId: 'kyrub-security-test';
  scope: 'emulator';
  month: string;
  coverage: 'partial';
  observedMarkers: number;
  sealedAtMs: number;
  consolidatedAtMs: number;
  realMau: null;
};
type Fence = {
  schemaVersion: 1; projectId: 'kyrub-security-test'; scope: 'emulator';
  month: string; status: 'sealed'; sealedAtMs: number;
};

// Not wired into any route or job. Explicit isolated emulator only.
// A parent fence is immutable by this service and read in every marker transaction.
export async function closeMonthlyPresenceFixture(
  db: ClosureDb, projectId: string, month: string, now: Date,
): Promise<MonthlyFixtureSummary> {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8088' ||
      process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production' ||
      projectId !== 'kyrub-security-test') throw Error('MAU_CLOSURE_EMULATOR_ONLY');
  const currentMonth = presenceMonth(now);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month >= currentMonth)
    throw Error('MAU_CLOSURE_PERIOD_NOT_ENDED');
  const nowMs = now.getTime();
  const parent = 'kyrub_finops_mau_months/' + month;
  const fenceRef = db.doc(parent);
  const summaryRef = db.doc(parent + '/summaries/observed');
  const matchesFence = (data: Partial<Fence> | undefined): data is Fence =>
    data?.schemaVersion === 1 && data.projectId === projectId && data.scope === 'emulator' &&
    data.month === month && data.status === 'sealed' && Number.isSafeInteger(data.sealedAtMs) &&
    data.sealedAtMs! >= 0 && data.sealedAtMs! <= nowMs &&
    presenceMonth(new Date(data.sealedAtMs!)) > month;
  const fence = await db.runTransaction(async tx => {
    const existing = await tx.get(fenceRef);
    if (existing.exists) {
      const data = existing.data() as Partial<Fence> | undefined;
      if (!matchesFence(data)) throw Error('MAU_CLOSURE_FENCE_INVALID');
      return data;
    }
    const data: Fence = {schemaVersion:1,projectId:'kyrub-security-test',scope:'emulator',
      month,status:'sealed',sealedAtMs:nowMs};
    tx.create(fenceRef,data);
    return data;
  });
  // After the fence commits, all cooperating marker transactions must fail
  // or have committed before sealing. An independent Admin writer could bypass it.
  const aggregate = await db.collection(parent + '/markers').count().get();
  const count = aggregate.data().count;
  if (!Number.isSafeInteger(count) || count < 0) throw Error('MAU_CLOSURE_COUNT_INVALID');
  return db.runTransaction(async tx => {
    const [state, existing] = await Promise.all([tx.get(fenceRef),tx.get(summaryRef)]);
    const current = state.data() as Partial<Fence> | undefined;
    if (!matchesFence(current) || current.sealedAtMs !== fence.sealedAtMs)
      throw Error('MAU_CLOSURE_FENCE_CHANGED');
    if (existing.exists) {
      const s = existing.data() as Partial<MonthlyFixtureSummary> | undefined;
      if (s?.schemaVersion !== 1 || s.projectId !== projectId || s.scope !== 'emulator' ||
          s.month !== month || s.coverage !== 'partial' || s.realMau !== null ||
          s.observedMarkers !== count || s.sealedAtMs !== fence.sealedAtMs ||
          !Number.isSafeInteger(s.consolidatedAtMs) || s.consolidatedAtMs! < fence.sealedAtMs ||
          s.consolidatedAtMs! > nowMs) throw Error('MAU_CLOSURE_SUMMARY_MISMATCH');
      return s as MonthlyFixtureSummary;
    }
    const summary: MonthlyFixtureSummary = {schemaVersion:1,projectId:'kyrub-security-test',
      scope:'emulator',month,coverage:'partial',observedMarkers:count,
      sealedAtMs:fence.sealedAtMs,consolidatedAtMs:nowMs,realMau:null};
    tx.create(summaryRef,summary);
    return summary;
  });
}
