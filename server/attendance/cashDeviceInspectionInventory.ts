/**
 * Inventory is discovered from employee submissions, not a registry of
 * employee-owned phones. A browser installation may share reports across staff.
 * These are self-reports; neither uniqueness of physical handsets nor a full
 * census can be inferred.
 */
export type CashDeviceInventoryCount = {
  currentActorPending: number;
  otherActorsPending: number;
  unattributedPending: number;
  localOpenSessions: number;
  pendingOpeningOperations: number;
  pendingMovementOperations: number;
  pendingClosingOperations: number;
};

export type CashDeviceInspectionRow = {
  id: string;
  deviceKey: string;
  actorUserId: string;
  reportedAtMs: number;
  counts: CashDeviceInventoryCount;
};

export type CashDeviceInventoryBrowser = {
  browserKey: string;
  reporterCount: number;
  reportedAt: string;
  pendingOperations: number;
  openSessions: number;
  needsAttention: boolean;
  legacyUnlinked: boolean;
};

export type CashManagerDeviceInventory = {
  discovery: 'submitted-reports-only';
  readOnly: true;
  selfReported: true;
  cutoverApproved: false;
  allBrowsersKnown: false;
  observedBrowsers: number;
  reportingCollaborators: number;
  withReportedPending: number;
  withoutReportedPending: number;
  legacyUnlinkedReports: number;
  browsers: CashDeviceInventoryBrowser[];
};

export const requireCashInventoryManagerRole = (role: string): void => {
  if (role !== 'owner' && role !== 'manager') {
    throw new Error('CASH_REGISTER_FORBIDDEN');
  }
};

export const aggregateCashDeviceInspections = (
  rows: readonly CashDeviceInspectionRow[]
): CashManagerDeviceInventory => {
  const grouped = new Map<string, { reporters: Set<string>; latest: CashDeviceInspectionRow; legacyUnlinked: boolean }>();
  const actors = new Set<string>();
  for (const row of rows) {
    // Earlier #933 reports contain actor+browser IDs but not a shared
    // browserKey. Preserve them as separate unlinked reports instead of
    // guessing that two different people used the same phone.
    const key = row.deviceKey || row.id;
    if (!key) continue;
    const existing = grouped.get(key);
    actors.add(row.actorUserId);
    if (!existing) {
      grouped.set(key, {
        reporters: new Set([row.actorUserId]),
        latest: row,
        legacyUnlinked: !row.deviceKey,
      });
    } else {
      existing.reporters.add(row.actorUserId);
      if (
        row.reportedAtMs > existing.latest.reportedAtMs ||
        (row.reportedAtMs === existing.latest.reportedAtMs && row.id > existing.latest.id)
      ) existing.latest = row;
    }
  }

  const browsers = [...grouped].map(([browserKey, group]) => {
    const counts = group.latest.counts;
    // The same Dexie queue is seen by each account on this browser.
    // Only the latest report represents the observed queue. Never sum
    // account reports, as doing so double-counts shared-device operations.
    const pendingOperations = counts.currentActorPending +
      counts.otherActorsPending + counts.unattributedPending;
    return {
      browserKey,
      reporterCount: group.reporters.size,
      reportedAt: new Date(group.latest.reportedAtMs).toISOString(),
      pendingOperations,
      openSessions: counts.localOpenSessions,
      needsAttention: pendingOperations > 0 || counts.localOpenSessions > 0,
      legacyUnlinked: group.legacyUnlinked,
    };
  }).sort((a,b) => b.reportedAt.localeCompare(a.reportedAt) || a.browserKey.localeCompare(b.browserKey));

  return {
    discovery: 'submitted-reports-only',
    readOnly: true,
    selfReported: true,
    cutoverApproved: false,
    allBrowsersKnown: false,
    observedBrowsers: browsers.length,
    reportingCollaborators: actors.size,
    withReportedPending: browsers.filter(row => row.needsAttention).length,
    withoutReportedPending: browsers.filter(row => !row.needsAttention).length,
    legacyUnlinkedReports: browsers.filter(row => row.legacyUnlinked).length,
    browsers,
  };
};
