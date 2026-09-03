import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin';

const PROVIDER = '99food' as const;
const BINDING_AUTHORITY = 'store_owner_product_mapping' as const;

const clean = (value: unknown, maximum = 500): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const bindingIdFor = (canonicalStoreId: string, externalStoreId: string, externalProductId: string): string =>
  `99food_${createHash('sha256')
    .update([canonicalStoreId, PROVIDER, externalStoreId, externalProductId].join(':'))
    .digest('hex')
    .slice(0, 40)}`;

const bindingPath = (canonicalStoreId: string, bindingId: string): string =>
  `stores/${canonicalStoreId}/externalProductBindings/${bindingId}`;

const auditPath = (canonicalStoreId: string, bindingId: string, revision: number): string =>
  `stores/${canonicalStoreId}/externalProductBindingAudits/${bindingId}__r${revision}`;

interface TenantAuthority {
  tenantId: string;
  canonicalStoreId: string;
  externalStoreId: string;
}

export interface NinetyNineFoodProductBinding {
  schemaVersion: 1;
  id: string;
  provider: typeof PROVIDER;
  tenantId: string;
  canonicalStoreId: string;
  externalStoreId: string;
  externalProductId: string;
  canonicalProductId: string;
  status: 'active' | 'inactive';
  revision: number;
  bindingAuthority: typeof BINDING_AUTHORITY;
  boundByUserId: string;
  boundAt: string;
  updatedAt: string;
}

const resolveTenantAuthority = async (tenantId: string): Promise<TenantAuthority> => {
  const normalizedTenantId = clean(tenantId, 160);
  if (!normalizedTenantId) throw new Error('NINETY_NINE_FOOD_PRODUCT_BINDING_TENANT_REQUIRED');

  const [tenantDocument, connectionDocument] = await Promise.all([
    adminDb.doc(`tenants/${normalizedTenantId}`).get(),
    adminDb.doc(`integrationConnections/${normalizedTenantId}__99food`).get(),
  ]);
  const canonicalStoreId = clean(tenantDocument.data()?.canonicalStoreId, 160);
  if (!canonicalStoreId) throw new Error('NINETY_NINE_FOOD_PRODUCT_BINDING_CANONICAL_STORE_REQUIRED');
  if (!connectionDocument.exists) throw new Error('NINETY_NINE_FOOD_PRODUCT_BINDING_CONNECTION_REQUIRED');
  const connection = connectionDocument.data() as Record<string, unknown>;
  if (connection.provider !== PROVIDER || clean(connection.tenantId, 160) !== normalizedTenantId) {
    throw new Error('NINETY_NINE_FOOD_PRODUCT_BINDING_CONNECTION_INVALID');
  }
  const externalStoreId = clean(connection.externalStoreId, 240);
  if (!externalStoreId) throw new Error('NINETY_NINE_FOOD_PRODUCT_BINDING_CONNECTION_INVALID');
  return { tenantId: normalizedTenantId, canonicalStoreId, externalStoreId };
};

const assertCanonicalProduct = (canonicalStoreId: string, canonicalProductId: string, value: unknown): void => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('NINETY_NINE_FOOD_PRODUCT_BINDING_CANONICAL_PRODUCT_NOT_FOUND');
  }
  const product = value as Record<string, unknown>;
  if (
    clean(product.id, 160) !== canonicalProductId ||
    clean(product.storeId, 160) !== canonicalStoreId ||
    product.isService === true
  ) {
    throw new Error('NINETY_NINE_FOOD_PRODUCT_BINDING_CANONICAL_PRODUCT_INVALID');
  }
};

const assertBinding = (value: unknown): NinetyNineFoodProductBinding => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('NINETY_NINE_FOOD_PRODUCT_BINDING_NOT_FOUND');
  }
  const binding = value as Record<string, unknown>;
  const revision = Number(binding.revision);
  if (
    binding.provider !== PROVIDER ||
    binding.bindingAuthority !== BINDING_AUTHORITY ||
    !clean(binding.id, 160) ||
    !clean(binding.tenantId, 160) ||
    !clean(binding.canonicalStoreId, 160) ||
    !clean(binding.externalStoreId, 240) ||
    !clean(binding.externalProductId, 500) ||
    !clean(binding.canonicalProductId, 160) ||
    (binding.status !== 'active' && binding.status !== 'inactive') ||
    !Number.isSafeInteger(revision) || revision < 1
  ) {
    throw new Error('NINETY_NINE_FOOD_PRODUCT_BINDING_INVALID');
  }
  return binding as unknown as NinetyNineFoodProductBinding;
};

export const listNinetyNineFoodProductBindings = async (input: {
  tenantId: string;
  requestedByUserId: string;
}): Promise<{ canonicalStoreId: string; externalStoreId: string; items: NinetyNineFoodProductBinding[] }> => {
  const tenantId = clean(input.tenantId, 160);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  if (!tenantId || requestedByUserId !== tenantId) throw new Error('NINETY_NINE_FOOD_PRODUCT_BINDING_FORBIDDEN');
  const authority = await resolveTenantAuthority(tenantId);
  const snapshot = await adminDb.collection(`stores/${authority.canonicalStoreId}/externalProductBindings`).get();
  const items = snapshot.docs.flatMap(document => {
    try {
      const binding = assertBinding(document.data());
      return binding.provider === PROVIDER && binding.tenantId === tenantId && binding.externalStoreId === authority.externalStoreId
        ? [binding]
        : [];
    } catch {
      return [];
    }
  }).sort((left, right) => left.externalProductId.localeCompare(right.externalProductId));
  return { canonicalStoreId: authority.canonicalStoreId, externalStoreId: authority.externalStoreId, items };
};

export const bindNinetyNineFoodProduct = async (input: {
  tenantId: string;
  externalProductId: string;
  canonicalProductId: string;
  boundByUserId: string;
}): Promise<{ binding: NinetyNineFoodProductBinding; alreadyBound: boolean }> => {
  const tenantId = clean(input.tenantId, 160);
  const externalProductId = clean(input.externalProductId, 500);
  const canonicalProductId = clean(input.canonicalProductId, 160);
  const boundByUserId = clean(input.boundByUserId, 160);
  if (!tenantId || !externalProductId || !canonicalProductId || boundByUserId !== tenantId) {
    throw new Error('NINETY_NINE_FOOD_PRODUCT_BINDING_INPUT_INVALID');
  }
  const authority = await resolveTenantAuthority(tenantId);
  const bindingId = bindingIdFor(authority.canonicalStoreId, authority.externalStoreId, externalProductId);
  const bindingReference = adminDb.doc(bindingPath(authority.canonicalStoreId, bindingId));
  const canonicalProductReference = adminDb.doc(`stores/${authority.canonicalStoreId}/products/${canonicalProductId}`);
  let result: { binding: NinetyNineFoodProductBinding; alreadyBound: boolean } | null = null;

  await adminDb.runTransaction(async transaction => {
    const [bindingDocument, productDocument] = await Promise.all([
      transaction.get(bindingReference),
      transaction.get(canonicalProductReference),
    ]);
    if (!productDocument.exists) throw new Error('NINETY_NINE_FOOD_PRODUCT_BINDING_CANONICAL_PRODUCT_NOT_FOUND');
    assertCanonicalProduct(authority.canonicalStoreId, canonicalProductId, productDocument.data());

    if (bindingDocument.exists) {
      const existing = assertBinding(bindingDocument.data());
      if (
        existing.tenantId !== tenantId ||
        existing.canonicalStoreId !== authority.canonicalStoreId ||
        existing.externalStoreId !== authority.externalStoreId ||
        existing.externalProductId !== externalProductId
      ) {
        throw new Error('NINETY_NINE_FOOD_PRODUCT_BINDING_CONFLICT');
      }
      if (existing.status === 'active') {
        if (existing.canonicalProductId !== canonicalProductId) {
          throw new Error('NINETY_NINE_FOOD_PRODUCT_BINDING_ALREADY_ACTIVE');
        }
        result = { binding: existing, alreadyBound: true };
        return;
      }

      const revision = existing.revision + 1;
      const now = new Date().toISOString();
      const next: NinetyNineFoodProductBinding = {
        ...existing,
        canonicalProductId,
        status: 'active',
        revision,
        boundByUserId,
        boundAt: now,
        updatedAt: now,
      };
      transaction.update(bindingReference, {
        canonicalProductId,
        status: 'active',
        revision,
        boundByUserId,
        boundAt: now,
        updatedAt: now,
        serverUpdatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(adminDb.doc(auditPath(authority.canonicalStoreId, bindingId, revision)), {
        schemaVersion: 1,
        bindingId,
        provider: PROVIDER,
        tenantId,
        canonicalStoreId: authority.canonicalStoreId,
        externalStoreId: authority.externalStoreId,
        externalProductId,
        previousCanonicalProductId: existing.canonicalProductId,
        canonicalProductId,
        action: 'reactivated',
        revision,
        authority: BINDING_AUTHORITY,
        actorUserId: boundByUserId,
        occurredAt: now,
        serverCreatedAt: FieldValue.serverTimestamp(),
      });
      result = { binding: next, alreadyBound: false };
      return;
    }

    const now = new Date().toISOString();
    const binding: NinetyNineFoodProductBinding = {
      schemaVersion: 1,
      id: bindingId,
      provider: PROVIDER,
      tenantId,
      canonicalStoreId: authority.canonicalStoreId,
      externalStoreId: authority.externalStoreId,
      externalProductId,
      canonicalProductId,
      status: 'active',
      revision: 1,
      bindingAuthority: BINDING_AUTHORITY,
      boundByUserId,
      boundAt: now,
      updatedAt: now,
    };
    transaction.create(bindingReference, {
      ...binding,
      serverCreatedAt: FieldValue.serverTimestamp(),
      serverUpdatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(adminDb.doc(auditPath(authority.canonicalStoreId, bindingId, 1)), {
      schemaVersion: 1,
      bindingId,
      provider: PROVIDER,
      tenantId,
      canonicalStoreId: authority.canonicalStoreId,
      externalStoreId: authority.externalStoreId,
      externalProductId,
      canonicalProductId,
      action: 'created',
      revision: 1,
      authority: BINDING_AUTHORITY,
      actorUserId: boundByUserId,
      occurredAt: now,
      serverCreatedAt: FieldValue.serverTimestamp(),
    });
    result = { binding, alreadyBound: false };
  });

  if (!result) throw new Error('NINETY_NINE_FOOD_PRODUCT_BINDING_FAILED');
  return result;
};

export const deactivateNinetyNineFoodProductBinding = async (input: {
  tenantId: string;
  externalProductId: string;
  deactivatedByUserId: string;
}): Promise<{ bindingId: string; status: 'inactive'; alreadyInactive: boolean }> => {
  const tenantId = clean(input.tenantId, 160);
  const externalProductId = clean(input.externalProductId, 500);
  const deactivatedByUserId = clean(input.deactivatedByUserId, 160);
  if (!tenantId || !externalProductId || deactivatedByUserId !== tenantId) {
    throw new Error('NINETY_NINE_FOOD_PRODUCT_BINDING_INPUT_INVALID');
  }
  const authority = await resolveTenantAuthority(tenantId);
  const bindingId = bindingIdFor(authority.canonicalStoreId, authority.externalStoreId, externalProductId);
  const bindingReference = adminDb.doc(bindingPath(authority.canonicalStoreId, bindingId));
  let alreadyInactive = false;

  await adminDb.runTransaction(async transaction => {
    const document = await transaction.get(bindingReference);
    if (!document.exists) throw new Error('NINETY_NINE_FOOD_PRODUCT_BINDING_NOT_FOUND');
    const binding = assertBinding(document.data());
    if (
      binding.tenantId !== tenantId ||
      binding.canonicalStoreId !== authority.canonicalStoreId ||
      binding.externalStoreId !== authority.externalStoreId ||
      binding.externalProductId !== externalProductId
    ) throw new Error('NINETY_NINE_FOOD_PRODUCT_BINDING_CONFLICT');
    if (binding.status === 'inactive') {
      alreadyInactive = true;
      return;
    }
    const revision = binding.revision + 1;
    const now = new Date().toISOString();
    transaction.update(bindingReference, {
      status: 'inactive',
      revision,
      updatedAt: now,
      deactivatedByUserId,
      deactivatedAt: now,
      serverUpdatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(adminDb.doc(auditPath(authority.canonicalStoreId, bindingId, revision)), {
      schemaVersion: 1,
      bindingId,
      provider: PROVIDER,
      tenantId,
      canonicalStoreId: authority.canonicalStoreId,
      externalStoreId: authority.externalStoreId,
      externalProductId,
      canonicalProductId: binding.canonicalProductId,
      action: 'deactivated',
      revision,
      authority: BINDING_AUTHORITY,
      actorUserId: deactivatedByUserId,
      occurredAt: now,
      serverCreatedAt: FieldValue.serverTimestamp(),
    });
  });

  return { bindingId, status: 'inactive', alreadyInactive };
};

export const resolveActiveNinetyNineFoodProductBinding = async (input: {
  tenantId: string;
  externalProductId: string;
}): Promise<NinetyNineFoodProductBinding | null> => {
  const tenantId = clean(input.tenantId, 160);
  const externalProductId = clean(input.externalProductId, 500);
  if (!tenantId || !externalProductId) return null;
  const authority = await resolveTenantAuthority(tenantId);
  const bindingId = bindingIdFor(authority.canonicalStoreId, authority.externalStoreId, externalProductId);
  const document = await adminDb.doc(bindingPath(authority.canonicalStoreId, bindingId)).get();
  if (!document.exists) return null;
  const binding = assertBinding(document.data());
  if (
    binding.status !== 'active' ||
    binding.tenantId !== tenantId ||
    binding.canonicalStoreId !== authority.canonicalStoreId ||
    binding.externalStoreId !== authority.externalStoreId ||
    binding.externalProductId !== externalProductId
  ) return null;
  return binding;
};
