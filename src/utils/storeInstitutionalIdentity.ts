import type { User } from 'firebase/auth';
import type { Store } from '../types';
import {
  projectStoreInstitutionalIdentity,
  type StoreInstitutionalIdentity,
  type StoreInstitutionalRepresentation,
  type StoreInstitutionalRole,
  type StoreInstitutionalCapability,
} from '../../shared/storeInstitutionalIdentity';

const ROLES: readonly StoreInstitutionalRole[] = ['owner', 'manager', 'attendant'];
const CAPABILITIES: readonly StoreInstitutionalCapability[] = [
  'identity_manage',
  'team_manage',
  'relationship_read',
  'conversation_act',
  'notification_act',
];

export const projectStoreIdentityFromStore = (
  store: Pick<
    Store,
    | 'id'
    | 'name'
    | 'slug'
    | 'description'
    | 'logo'
    | 'banner'
    | 'primaryColor'
    | 'keywords'
    | 'address'
    | 'contact'
    | 'status'
  >
): StoreInstitutionalIdentity =>
  projectStoreInstitutionalIdentity({
    storeId: store.id,
    name: store.name,
    slug: store.slug,
    description: store.description,
    logo: store.logo,
    banner: store.banner,
    primaryColor: store.primaryColor,
    keywords: store.keywords ?? [],
    address: store.address ?? '',
    contact: store.contact ?? '',
    status: store.status ?? 'closed',
  });

export const loadStoreInstitutionalRepresentation = async (
  user: Pick<User, 'uid' | 'getIdToken'>,
  storeIdInput: string
): Promise<StoreInstitutionalRepresentation> => {
  const storeId = storeIdInput.trim();
  if (!storeId || user.uid !== storeId) {
    throw new Error('Faça login novamente para representar sua loja.');
  }

  const token = await user.getIdToken();
  const response = await fetch(
    `/api/store-identity?storeId=${encodeURIComponent(storeId)}`,
    {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    }
  );
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'Não foi possível carregar a identidade da loja.'
    );
  }

  const role = payload.role;
  const identity = payload.identity;
  const capabilities = payload.capabilities;
  if (
    !ROLES.includes(role as StoreInstitutionalRole) ||
    !identity ||
    typeof identity !== 'object' ||
    !Array.isArray(capabilities) ||
    payload.authenticatedUserId !== user.uid
  ) {
    throw new Error('A identidade institucional retornou uma resposta inválida.');
  }

  const projectedIdentity = projectStoreInstitutionalIdentity(
    identity as Record<string, unknown>
  );
  const validCapabilities = capabilities.filter(
    (capability): capability is StoreInstitutionalCapability =>
      CAPABILITIES.includes(capability as StoreInstitutionalCapability)
  );
  if (validCapabilities.length !== capabilities.length) {
    throw new Error('A representação da loja retornou permissões inválidas.');
  }

  return {
    identity: projectedIdentity,
    authenticatedUserId: user.uid,
    role: role as StoreInstitutionalRole,
    capabilities: validCapabilities,
  };
};
