export const STORE_TEAM_COMPENSATION_SCHEMA_VERSION = 1 as const;
export const STORE_TEAM_COMPENSATION_CURRENCY = 'BRL' as const;

export type StoreTeamCompensationKind = 'salary' | 'fixed_fee';
export type StoreTeamCompensationSourceAuthority = 'store_owner_manual';

export interface StoreTeamCompensation {
  schemaVersion: typeof STORE_TEAM_COMPENSATION_SCHEMA_VERSION;
  id: string;
  financeStoreId: string;
  teamStoreId: string;
  memberUserId: string;
  memberDisplayNameSnapshot: string;
  memberRoleSnapshot: string;
  kind: StoreTeamCompensationKind;
  currency: typeof STORE_TEAM_COMPENSATION_CURRENCY;
  monthlyAmountMinor: number;
  payDay: number;
  active: boolean;
  sourceAuthority: StoreTeamCompensationSourceAuthority;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const validIso = (value: string): boolean =>
  Boolean(value) && Number.isFinite(Date.parse(value));

const validPathId = (value: string): boolean =>
  Boolean(value) && value.length <= 240 && value !== '.' && value !== '..' && !value.includes('/');

const requiredText = (value: unknown, label: string, maxLength: number): string => {
  const text = clean(value);
  if (!text || text.length > maxLength) {
    throw new Error(`STORE_TEAM_COMPENSATION_${label}_INVALID`);
  }
  return text;
};

const positiveMinor = (value: unknown): number => {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('STORE_TEAM_COMPENSATION_AMOUNT_INVALID');
  }
  return amount;
};

const validKind = (value: unknown): value is StoreTeamCompensationKind =>
  value === 'salary' || value === 'fixed_fee';

const validPayDay = (value: unknown): number => {
  const payDay = Number(value);
  if (!Number.isSafeInteger(payDay) || payDay < 1 || payDay > 28) {
    throw new Error('STORE_TEAM_COMPENSATION_PAY_DAY_INVALID');
  }
  return payDay;
};

export const storeTeamCompensationId = (memberUserIdInput: string): string => {
  const memberUserId = clean(memberUserIdInput);
  if (!validPathId(memberUserId)) {
    throw new Error('STORE_TEAM_COMPENSATION_MEMBER_INVALID');
  }
  return memberUserId;
};

export const storeTeamCompensationPath = (
  financeStoreIdInput: string,
  memberUserIdInput: string
): string => {
  const financeStoreId = clean(financeStoreIdInput);
  const memberUserId = storeTeamCompensationId(memberUserIdInput);
  if (!validPathId(financeStoreId)) {
    throw new Error('STORE_TEAM_COMPENSATION_STORE_INVALID');
  }
  return `stores/${financeStoreId}/teamCompensations/${encodeURIComponent(memberUserId)}`;
};

export const normalizeStoreTeamCompensation = (value: unknown): StoreTeamCompensation => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('STORE_TEAM_COMPENSATION_INVALID');
  }

  const source = value as Partial<StoreTeamCompensation>;
  const id = requiredText(source.id, 'ID', 240);
  const financeStoreId = requiredText(source.financeStoreId, 'FINANCE_STORE', 240);
  const teamStoreId = requiredText(source.teamStoreId, 'TEAM_STORE', 240);
  const memberUserId = requiredText(source.memberUserId, 'MEMBER', 240);
  const memberDisplayNameSnapshot = requiredText(source.memberDisplayNameSnapshot, 'MEMBER_NAME', 160);
  const memberRoleSnapshot = requiredText(source.memberRoleSnapshot, 'MEMBER_ROLE', 60);
  const createdByUserId = requiredText(source.createdByUserId, 'CREATED_BY', 240);
  const createdAt = clean(source.createdAt);
  const updatedAt = clean(source.updatedAt);

  if (
    source.schemaVersion !== STORE_TEAM_COMPENSATION_SCHEMA_VERSION
    || id !== memberUserId
    || !validPathId(id)
    || !validPathId(financeStoreId)
    || !validPathId(teamStoreId)
    || !validPathId(memberUserId)
    || !validKind(source.kind)
    || source.currency !== STORE_TEAM_COMPENSATION_CURRENCY
    || typeof source.active !== 'boolean'
    || source.sourceAuthority !== 'store_owner_manual'
    || !validIso(createdAt)
    || !validIso(updatedAt)
  ) {
    throw new Error('STORE_TEAM_COMPENSATION_INVALID');
  }

  return {
    schemaVersion: STORE_TEAM_COMPENSATION_SCHEMA_VERSION,
    id,
    financeStoreId,
    teamStoreId,
    memberUserId,
    memberDisplayNameSnapshot,
    memberRoleSnapshot,
    kind: source.kind,
    currency: STORE_TEAM_COMPENSATION_CURRENCY,
    monthlyAmountMinor: positiveMinor(source.monthlyAmountMinor),
    payDay: validPayDay(source.payDay),
    active: source.active,
    sourceAuthority: 'store_owner_manual',
    createdByUserId,
    createdAt,
    updatedAt,
  };
};

export const buildStoreTeamCompensation = (input: {
  financeStoreId: string;
  teamStoreId: string;
  memberUserId: string;
  memberDisplayNameSnapshot: string;
  memberRoleSnapshot: string;
  kind: StoreTeamCompensationKind;
  monthlyAmountMinor: number;
  payDay: number;
  active: boolean;
  createdByUserId: string;
  createdAt?: string;
  now?: string;
}): StoreTeamCompensation => {
  const now = clean(input.now) || new Date().toISOString();
  return normalizeStoreTeamCompensation({
    schemaVersion: STORE_TEAM_COMPENSATION_SCHEMA_VERSION,
    id: storeTeamCompensationId(input.memberUserId),
    financeStoreId: input.financeStoreId,
    teamStoreId: input.teamStoreId,
    memberUserId: input.memberUserId,
    memberDisplayNameSnapshot: input.memberDisplayNameSnapshot,
    memberRoleSnapshot: input.memberRoleSnapshot,
    kind: input.kind,
    currency: STORE_TEAM_COMPENSATION_CURRENCY,
    monthlyAmountMinor: input.monthlyAmountMinor,
    payDay: input.payDay,
    active: input.active,
    sourceAuthority: 'store_owner_manual',
    createdByUserId: input.createdByUserId,
    createdAt: clean(input.createdAt) || now,
    updatedAt: now,
  });
};