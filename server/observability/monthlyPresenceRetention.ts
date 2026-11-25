import { presenceMonth } from './monthlyPresence.js';

// Proposed operational retention window: retain three complete calendar
// months AFTER the activity month. This is not legal approval or a deletion job.
export const MONTHLY_MARKER_GRACE_MONTHS = 3;
export type MonthlyRetentionEvidence = {
  projectId: string;
  scope: 'emulator' | 'production';
  month: string;
  writerFence?: { projectId: string; month: string; evidenceRef: string; sealedAtMs: number };
  summary?: {
    projectId: string; month: string; scope: 'emulator' | 'production';
    coverage: 'complete' | 'partial' | 'unavailable';
    observedMarkers: number; evidenceRef: string; fenceRef: string; persistedAtMs: number;
  };
  verifiedCount?: { projectId: string; month: string; count: number; fenceRef: string; observedAtMs: number };
  governance?: { policyApproved: boolean; legalHold: boolean; pendingRightsRequest: boolean; evidenceRef: string };
};
export type MonthlyRetentionDecision = {
  status: 'retain' | 'blocked' | 'review_candidate';
  reason: string;
  month: string;
  earliestReviewMonth: string | null;
};

const validMonth = (month: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
const ordinal = (month: string): number => Number(month.slice(0,4))*12+Number(month.slice(5,7))-1;
const monthFromOrdinal = (n:number): string =>
  String(Math.floor(n/12)).padStart(4,'0')+'-'+String(n%12+1).padStart(2,'0');
const ref = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;
const safeCount = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const validTime = (value: number, now: number): boolean =>
  Number.isSafeInteger(value) && value >= 0 && value <= now;

// No I/O, no deletion authority. Evidence is provided by future authorized
// lifecycle/reconciliation jobs; this function does NOT establish its truth.
export function evaluateMonthlyMarkerRetention(
  e: MonthlyRetentionEvidence,
  expectedProjectId: string,
  expectedScope: 'emulator' | 'production',
  now: Date,
): MonthlyRetentionDecision {
  const nowMs = now.getTime();
  const currentMonth = presenceMonth(now);
  const result = (status: MonthlyRetentionDecision['status'], reason: string, earliestReviewMonth: string | null = null): MonthlyRetentionDecision =>
    ({status,reason,month:e.month,earliestReviewMonth});
  if (!validMonth(e.month) || !ref(expectedProjectId) || e.projectId !== expectedProjectId ||
      e.scope !== expectedScope || !['emulator','production'].includes(expectedScope))
    return result('blocked','INVALID_SCOPE');
  const earliest = monthFromOrdinal(ordinal(e.month)+1+MONTHLY_MARKER_GRACE_MONTHS);
  if (ordinal(currentMonth) < ordinal(earliest)) return result('retain','GRACE_WINDOW',earliest);
  const g = e.governance;
  if (!g || g.policyApproved !== true || g.legalHold !== false ||
      g.pendingRightsRequest !== false || !ref(g.evidenceRef))
    return result('blocked','GOVERNANCE_PENDING',earliest);
  const f = e.writerFence;
  if (!f || f.projectId !== expectedProjectId || f.month !== e.month || !ref(f.evidenceRef) ||
      !validTime(f.sealedAtMs, nowMs) ||
      ordinal(presenceMonth(new Date(f.sealedAtMs))) <= ordinal(e.month))
    return result('blocked','WRITER_FENCE_UNPROVEN',earliest);
  const s = e.summary;
  if (!s || s.projectId !== expectedProjectId || s.scope !== expectedScope || s.month !== e.month ||
      s.coverage !== 'complete' || !safeCount(s.observedMarkers) || !ref(s.evidenceRef) ||
      s.fenceRef !== f.evidenceRef || !validTime(s.persistedAtMs, nowMs) || s.persistedAtMs < f.sealedAtMs)
    return result('blocked','SUMMARY_UNPROVEN',earliest);
  const v = e.verifiedCount;
  if (!v || v.projectId !== expectedProjectId || v.month !== e.month || v.fenceRef !== f.evidenceRef ||
      !safeCount(v.count) || v.count !== s.observedMarkers ||
      !validTime(v.observedAtMs, nowMs) || v.observedAtMs < s.persistedAtMs)
    return result('blocked','COUNT_UNRECONCILED',earliest);
  return result('review_candidate','REVIEW_REQUIRED',earliest);
}
