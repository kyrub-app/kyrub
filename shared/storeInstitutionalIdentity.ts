export const STORE_INSTITUTIONAL_IDENTITY_SCHEMA_VERSION = 1 as const;

export type StoreInstitutionalRole = 'owner' | 'manager' | 'attendant';

export type StoreInstitutionalCapability =
  | 'identity_manage'
  | 'team_manage'
  | 'relationship_read'
  | 'conversation_act'
  | 'notification_act';

export interface StoreInstitutionalIdentity {
  schemaVersion: typeof STORE_INSTITUTIONAL_IDENTITY_SCHEMA_VERSION;
  principalId: string;
  storeId: string;
  displayName: string;
  slug: string;
  description: string;
  avatarUrl: string;
  bannerUrl: string;
  primaryColor: string;
  keywords: string[];
  address: string;
  contact: string;
  status: 'open' | 'delayed' | 'closed';
}

export interface StoreInstitutionalRepresentation {
  identity: StoreInstitutionalIdentity;
  authenticatedUserId: string;
  role: StoreInstitutionalRole;
  capabilities: StoreInstitutionalCapability[];
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const cleanList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean)
    : [];

const normalizeStatus = (
  value: unknown
): StoreInstitutionalIdentity['status'] =>
  value === 'open' || value === 'delayed' || value === 'closed'
    ? value
    : 'closed';

export const buildStoreInstitutionalPrincipalId = (
  storeIdInput: string
): string => {
  const storeId = clean(storeIdInput);
  if (!storeId || storeId.includes('/')) {
    throw new Error('STORE_INSTITUTIONAL_ID_INVALID');
  }
  return `store:${storeId}`;
};

export const projectStoreInstitutionalIdentity = (
  input: Record<string, unknown>
): StoreInstitutionalIdentity => {
  const storeId = clean(input.storeId) || clean(input.id);
  const displayName = clean(input.displayName) || clean(input.name);
  if (!storeId) throw new Error('STORE_INSTITUTIONAL_ID_INVALID');
  if (!displayName) throw new Error('STORE_INSTITUTIONAL_NAME_REQUIRED');

  return {
    schemaVersion: STORE_INSTITUTIONAL_IDENTITY_SCHEMA_VERSION,
    principalId: buildStoreInstitutionalPrincipalId(storeId),
    storeId,
    displayName,
    slug: clean(input.slug),
    description: clean(input.description),
    avatarUrl: clean(input.avatarUrl) || clean(input.logo),
    bannerUrl: clean(input.bannerUrl) || clean(input.banner),
    primaryColor: clean(input.primaryColor),
    keywords: cleanList(input.keywords),
    address: clean(input.address),
    contact: clean(input.contact),
    status: normalizeStatus(input.status),
  };
};

const ROLE_CAPABILITIES: Record<
  StoreInstitutionalRole,
  readonly StoreInstitutionalCapability[]
> = {
  owner: [
    'identity_manage',
    'team_manage',
    'relationship_read',
    'conversation_act',
    'notification_act',
  ],
  manager: [
    'identity_manage',
    'relationship_read',
    'conversation_act',
    'notification_act',
  ],
  attendant: ['relationship_read', 'conversation_act'],
};

export const storeInstitutionalCapabilitiesForRole = (
  role: StoreInstitutionalRole
): StoreInstitutionalCapability[] => [...ROLE_CAPABILITIES[role]];

export const canRepresentStoreWithCapability = (
  role: StoreInstitutionalRole,
  capability: StoreInstitutionalCapability
): boolean => ROLE_CAPABILITIES[role].includes(capability);

export const buildStoreInstitutionalRepresentation = (input: {
  identity: StoreInstitutionalIdentity;
  authenticatedUserId: string;
  role: StoreInstitutionalRole;
}): StoreInstitutionalRepresentation => {
  const authenticatedUserId = clean(input.authenticatedUserId);
  if (!authenticatedUserId) throw new Error('STORE_REPRESENTATION_USER_REQUIRED');
  return {
    identity: input.identity,
    authenticatedUserId,
    role: input.role,
    capabilities: storeInstitutionalCapabilitiesForRole(input.role),
  };
};
