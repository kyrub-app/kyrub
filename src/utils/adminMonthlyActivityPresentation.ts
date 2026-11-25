// Deliberately exposes no real MAU: the current API supports fixture diagnostics only.
export function presentMonthlyActivity(value: unknown): {month:string|null;fixtureCount:number|null} {
  const missing = {month:null,fixtureCount:null};
  if (!value || typeof value !== 'object') return missing;
  const d = value as Record<string,unknown>;
  if (d.scope !== 'emulator_only' || d.status !== 'fixture_count' || d.realMau !== null ||
      typeof d.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(d.month) ||
      typeof d.observedMarkers !== 'number' || !Number.isSafeInteger(d.observedMarkers) ||
      d.observedMarkers < 0) return missing;
  return {month:d.month,fixtureCount:d.observedMarkers};
}
