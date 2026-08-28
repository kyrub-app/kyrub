export type KyrubEconomicParticipantRole =
  | 'buyer'
  | 'merchant'
  | 'courier'
  | 'freelancer'
  | 'service_provider'
  | 'platform'
  | 'payment_provider'
  | 'tax_authority';

export type KyrubEconomicEntryKind =
  | 'sale'
  | 'discount'
  | 'freight'
  | 'tip'
  | 'subsidy'
  | 'incentive'
  | 'platform_fee'
  | 'financial_cost'
  | 'tax'
  | 'refund'
  | 'chargeback'
  | 'cancellation_compensation'
  | 'adjustment';

export type KyrubEconomicLedgerSource =
  | 'marketplace_payment'
  | 'attendance_payment'
  | 'manual_adjustment';

export type KyrubEconomicPaymentMethod = 'pix' | 'card' | 'cash' | 'other';

export interface KyrubEconomicParticipantRef {
  id: string;
  role: KyrubEconomicParticipantRole;
}

export interface KyrubEconomicEntryReference {
  type: string;
  id: string;
}

export interface KyrubEconomicLedgerEntry {
  id: string;
  kind: KyrubEconomicEntryKind;
  amountMinor: number;
  fundedBy: KyrubEconomicParticipantRef;
  owedTo: KyrubEconomicParticipantRef;
  reference?: KyrubEconomicEntryReference | null;
  description?: string;
}

export interface KyrubEconomicLedger {
  id: string;
  transactionId: string;
  storeId: string;
  orderId: string;
  paymentId: string;
  paymentMethod: KyrubEconomicPaymentMethod | null;
  paymentProvider: string;
  currency: 'BRL';
  source: KyrubEconomicLedgerSource;
  status: 'posted';
  entries: KyrubEconomicLedgerEntry[];
  createdAt: string;
  schemaVersion: 1;
}

export interface KyrubEconomicPosition {
  participantId: string;
  role: KyrubEconomicParticipantRole;
  creditsMinor: number;
  debitsMinor: number;
  netMinor: number;
}

const PARTICIPANT_ROLES = new Set<KyrubEconomicParticipantRole>([
  'buyer',
  'merchant',
  'courier',
  'freelancer',
  'service_provider',
  'platform',
  'payment_provider',
  'tax_authority',
]);

const ENTRY_KINDS = new Set<KyrubEconomicEntryKind>([
  'sale',
  'discount',
  'freight',
  'tip',
  'subsidy',
  'incentive',
  'platform_fee',
  'financial_cost',
  'tax',
  'refund',
  'chargeback',
  'cancellation_compensation',
  'adjustment',
]);

const LEDGER_SOURCES = new Set<KyrubEconomicLedgerSource>([
  'marketplace_payment',
  'attendance_payment',
  'manual_adjustment',
]);

const PAYMENT_METHODS = new Set<KyrubEconomicPaymentMethod>([
  'pix',
  'card',
  'cash',
  'other',
]);

const required = (label: string, value: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
};

const normalizeParticipant = (
  participant: KyrubEconomicParticipantRef
): KyrubEconomicParticipantRef => {
  if (!PARTICIPANT_ROLES.has(participant.role)) {
    throw new Error('Economic ledger participant role is invalid.');
  }
  return {
    id: required('economic participant id', participant.id),
    role: participant.role,
  };
};

export const moneyToMinorUnits = (value: number): number => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Economic amount must be a finite non-negative number.');
  }
  const minor = Math.round(value * 100);
  if (Math.abs(value * 100 - minor) > 1e-7 || !Number.isSafeInteger(minor)) {
    throw new Error('Economic amount must have at most two decimal places.');
  }
  return minor;
};

export const normalizeKyrubEconomicLedgerEntry = (
  entry: KyrubEconomicLedgerEntry
): KyrubEconomicLedgerEntry => {
  if (!ENTRY_KINDS.has(entry.kind)) {
    throw new Error('Economic ledger entry kind is invalid.');
  }
  if (!Number.isSafeInteger(entry.amountMinor) || entry.amountMinor <= 0) {
    throw new Error('Economic ledger entry amount must be a positive integer in minor units.');
  }
  const fundedBy = normalizeParticipant(entry.fundedBy);
  const owedTo = normalizeParticipant(entry.owedTo);
  if (fundedBy.id === owedTo.id && fundedBy.role === owedTo.role) {
    throw new Error('Economic ledger entry cannot transfer value to the same participant.');
  }
  const reference = entry.reference
    ? {
        type: required('economic entry reference type', entry.reference.type),
        id: required('economic entry reference id', entry.reference.id),
      }
    : null;
  return {
    id: required('economic entry id', entry.id),
    kind: entry.kind,
    amountMinor: entry.amountMinor,
    fundedBy,
    owedTo,
    reference,
    description: entry.description?.trim() ?? '',
  };
};

export const deriveKyrubEconomicPositions = (
  entries: KyrubEconomicLedgerEntry[]
): KyrubEconomicPosition[] => {
  const positions = new Map<string, KyrubEconomicPosition>();
  const keyFor = (participant: KyrubEconomicParticipantRef): string =>
    `${participant.role}:${participant.id}`;
  const ensure = (participant: KyrubEconomicParticipantRef): KyrubEconomicPosition => {
    const key = keyFor(participant);
    const existing = positions.get(key);
    if (existing) return existing;
    const created: KyrubEconomicPosition = {
      participantId: participant.id,
      role: participant.role,
      creditsMinor: 0,
      debitsMinor: 0,
      netMinor: 0,
    };
    positions.set(key, created);
    return created;
  };

  for (const rawEntry of entries) {
    const entry = normalizeKyrubEconomicLedgerEntry(rawEntry);
    const funder = ensure(entry.fundedBy);
    const beneficiary = ensure(entry.owedTo);
    funder.debitsMinor += entry.amountMinor;
    beneficiary.creditsMinor += entry.amountMinor;
  }

  const result = Array.from(positions.values()).map(position => ({
    ...position,
    netMinor: position.creditsMinor - position.debitsMinor,
  }));
  const net = result.reduce((sum, position) => sum + position.netMinor, 0);
  if (net !== 0) {
    throw new Error('Economic ledger positions are not balanced.');
  }
  return result.sort((a, b) =>
    `${a.role}:${a.participantId}`.localeCompare(`${b.role}:${b.participantId}`)
  );
};

export const normalizeKyrubEconomicLedger = (
  ledger: KyrubEconomicLedger
): KyrubEconomicLedger => {
  if (!Array.isArray(ledger.entries) || ledger.entries.length === 0) {
    throw new Error('Economic ledger requires at least one entry.');
  }
  const entries = ledger.entries.map(normalizeKyrubEconomicLedgerEntry);
  const entryIds = new Set<string>();
  for (const entry of entries) {
    if (entryIds.has(entry.id)) {
      throw new Error(`Duplicate economic ledger entry id: ${entry.id}`);
    }
    entryIds.add(entry.id);
  }
  deriveKyrubEconomicPositions(entries);
  const createdAt = required('economic ledger createdAt', ledger.createdAt);
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new Error('Economic ledger createdAt must be an ISO timestamp.');
  }
  if (ledger.currency !== 'BRL') {
    throw new Error('Economic ledger currency must be BRL.');
  }
  if (!LEDGER_SOURCES.has(ledger.source)) {
    throw new Error('Economic ledger source is invalid.');
  }
  const paymentBacked = ledger.source === 'marketplace_payment' || ledger.source === 'attendance_payment';
  if (paymentBacked) {
    if (!ledger.paymentMethod || !PAYMENT_METHODS.has(ledger.paymentMethod)) {
      throw new Error('Payment-backed economic ledger method is invalid.');
    }
    required('economic ledger payment provider', ledger.paymentProvider);
  } else if (ledger.paymentMethod !== null && !PAYMENT_METHODS.has(ledger.paymentMethod)) {
    throw new Error('Economic ledger payment method is invalid.');
  }
  if (ledger.status !== 'posted') {
    throw new Error('Economic ledger must be posted and immutable.');
  }
  if (ledger.schemaVersion !== 1) {
    throw new Error('Economic ledger schema version is unsupported.');
  }
  return {
    id: required('economic ledger id', ledger.id),
    transactionId: required('economic ledger transaction id', ledger.transactionId),
    storeId: required('economic ledger store id', ledger.storeId),
    orderId: ledger.orderId.trim(),
    paymentId: ledger.paymentId.trim(),
    paymentMethod: ledger.paymentMethod,
    paymentProvider: ledger.paymentProvider.trim(),
    currency: 'BRL',
    source: ledger.source,
    status: 'posted',
    entries,
    createdAt,
    schemaVersion: 1,
  };
};
