/**
 * Read-only migration preflight for the EXISTING canonical Cash.
 * Never a second ledger and never authorization to switch modes.
 * Unknown Dexie queues on staff devices cannot be observed from the server.
 */
export type CutoverCashDocument = {
  id: string;
  data: Record<string, unknown>;
};

export type CashCutoverPreflight = {
  assessmentOnly: true;
  remoteSnapshotComplete: boolean;
  remotePreflightClear: boolean;
  activationAllowed: false;
  offlineDeviceQueuesVerified: false;
  openLegacySessions: number;
  openManagedSessions: number;
  inspectedRegisters: number;
  blockers: string[];
};

const cleanValue = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const assessCashCutoverPreflight = (input: {
  canonicalStoreId: string;
  openSessions: readonly CutoverCashDocument[];
  registers: readonly CutoverCashDocument[];
  openSessionLimitReached: boolean;
  registerLimitReached: boolean;
}): CashCutoverPreflight => {
  const blockers = new Set<string>();
  if (input.openSessionLimitReached || input.registerLimitReached) {
    blockers.add('REMOTE_SCAN_INCOMPLETE');
  }
  const openById = new Map(input.openSessions.map(session => [session.id, session]));
  const registersById = new Map(input.registers.map(register => [register.id, register]));
  let openLegacySessions = 0;
  let openManagedSessions = 0;
  const occupiedRegisters = new Set<string>();

  for (const session of input.openSessions) {
    const row = session.data;
    if (cleanValue(row.status) !== 'open' ||
      cleanValue(row.storeId) !== input.canonicalStoreId ||
      cleanValue(row.id) !== session.id) {
      blockers.add('SESSION_IDENTITY_INCONSISTENT');
    }
    const serverManaged = cleanValue(row.deviceId) === 'server-managed-register';
    if (!serverManaged) {
      openLegacySessions += 1;
      blockers.add('LEGACY_SESSION_OPEN');
      if (cleanValue(row.registerId)) blockers.add('LEGACY_SESSION_TERMINAL_AMBIGUOUS');
      continue;
    }
    openManagedSessions += 1;
    blockers.add('MANAGED_SESSION_ALREADY_OPEN');
    const registerId = cleanValue(row.registerId);
    if (!registerId || !registersById.has(registerId)) {
      blockers.add('MANAGED_SESSION_REGISTER_MISSING');
      continue;
    }
    if (occupiedRegisters.has(registerId)) blockers.add('MULTIPLE_OPEN_SESSIONS_PER_REGISTER');
    occupiedRegisters.add(registerId);
    const register = registersById.get(registerId)!;
    if (cleanValue(register.data.activeSessionId) !== session.id) {
      blockers.add('REGISTER_SESSION_POINTER_MISMATCH');
    }
  }

  for (const register of input.registers) {
    const row = register.data;
    if (cleanValue(row.id) !== register.id ||
      cleanValue(row.storeId) !== input.canonicalStoreId) {
      blockers.add('REGISTER_IDENTITY_INCONSISTENT');
    }
    const pointer = cleanValue(row.activeSessionId);
    if (pointer) {
      if (cleanValue(row.status) !== 'active') blockers.add('INACTIVE_REGISTER_WITH_OPEN_POINTER');
      const session = openById.get(pointer);
      if (!session) {
        blockers.add('REGISTER_POINTER_WITHOUT_OPEN_SESSION');
      } else if (cleanValue(session.data.registerId) !== register.id ||
        cleanValue(session.data.deviceId) !== 'server-managed-register') {
        blockers.add('REGISTER_SESSION_POINTER_MISMATCH');
      }
    }
  }

  const reasons = [...blockers].sort();
  return {
    assessmentOnly: true,
    remoteSnapshotComplete: !input.openSessionLimitReached && !input.registerLimitReached,
    remotePreflightClear: reasons.length === 0,
    activationAllowed: false,
    offlineDeviceQueuesVerified: false,
    openLegacySessions,
    openManagedSessions,
    inspectedRegisters: input.registers.length,
    blockers: reasons,
  };
};
