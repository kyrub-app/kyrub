import { adminDb } from '../firebaseAdmin.js';
import { getPrimaryUserStoreDocumentPath } from '../../src/utils/storePaths.js';
import { loadMercadoPagoStoreConnectionMetadata } from '../integrations/mercadoPagoStoreConnectionSecretStore.js';
import {
  isMercadoPagoMerchantPixRolloutAllowed,
  type MercadoPagoMerchantPixRolloutEnvironment,
} from '../payments/mercadoPagoMerchantPixRolloutPolicy.js';

// This is an ADMIN-only, bounded, read-only discovery of PUBLISHED tenants,
// not a report of actual sales volume. No tokens, secret references, complete
// provider IDs, writes or payment API requests are involved.
const MAX_PUBLISHED_STORES = 50;
const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';
const valid = (value: string): boolean =>
  Boolean(value) && value.length <= 180 && !value.includes('/');

export type MerchantPixInventoryReadiness =
  | 'oauth_connected_rollout_enabled'
  | 'oauth_connected_rollout_pending'
  | 'oauth_required'
  | 'identity_review'
  | 'connection_review';

export interface MerchantPixInventoryItem {
  canonicalStoreId: string;
  tenantId: string;
  storeName: string;
  publicationStatus: 'published';
  connection: 'connected' | 'not_connected' | 'review';
  providerAccountLast4: string;
  readiness: MerchantPixInventoryReadiness;
  needsLivePreflight: true;
}

export interface MerchantPixMigrationInventory {
  generatedAt: string;
  source: 'published_tenants';
  scanned: number;
  complete: boolean;
  requiresOperationalSalesReview: true;
  rolloutMode: 'disabled' | 'canary' | 'connected_stores';
  items: MerchantPixInventoryItem[];
  warnings: string[];
}

const rolloutMode = (env: MercadoPagoMerchantPixRolloutEnvironment): MerchantPixMigrationInventory['rolloutMode'] =>
  env.VERCEL_ENV === 'production' && env.KYRUB_MP_MERCHANT_PIX_ENABLED === 'true'
    ? env.KYRUB_MP_MERCHANT_PIX_ROLLOUT_MODE === 'canary'
      ? 'canary'
      : env.KYRUB_MP_MERCHANT_PIX_ROLLOUT_MODE === 'connected_stores'
        ? 'connected_stores'
        : 'disabled'
    : 'disabled';

export const loadMercadoPagoMerchantPixMigrationInventory = async (
  env: MercadoPagoMerchantPixRolloutEnvironment = process.env
): Promise<MerchantPixMigrationInventory> => {
  // Paged limit prevents unbounded reads; 51st row is a completeness warning,
  // not silently omitted evidence that every store is migration-ready.
  const tenants = await adminDb.collection('tenants')
    .where('publicationStatus', '==', 'published')
    .limit(MAX_PUBLISHED_STORES + 1)
    .get();
  const complete = tenants.size <= MAX_PUBLISHED_STORES;
  const candidates = tenants.docs.slice(0, MAX_PUBLISHED_STORES);
  const items = await Promise.all(candidates.map(async tenantDoc: FirebaseFirestore.QueryDocumentSnapshot => {
    const tenant = tenantDoc.data() as Record<string, unknown>;
    const tenantId = tenantDoc.id;
    const ownerId = clean(tenant.ownerId) || tenantId;
    const identityValid = valid(tenantId) && ownerId === tenantId;
    let canonicalStoreId = '';
    let storeName = '';
    let identityReview = !identityValid;

    if (identityValid) {
      const matches = await adminDb.collection('stores')
        .where('legacyTenantId', '==', tenantId).limit(2).get();
      if (matches.size > 1) {
        identityReview = true;
      } else if (matches.size === 1) {
        const store = matches.docs[0];
        const info = store.data() as Record<string, unknown>;
        if (clean(info.ownerId) !== ownerId || !valid(store.id)) {
          identityReview = true;
        } else {
          canonicalStoreId = store.id;
          storeName = clean(info.name);
        }
      } else {
        // Existing single-owner stores can be persisted only at this path.
        const primary = await adminDb.doc(getPrimaryUserStoreDocumentPath(tenantId)).get();
        const info = primary.data() as Record<string, unknown> | undefined;
        if (primary.exists && clean(info?.id) === tenantId && clean(info?.ownerId) === tenantId) {
          canonicalStoreId = tenantId;
          storeName = clean(info?.name);
        } else {
          identityReview = true;
        }
      }
    }

    let connection: MerchantPixInventoryItem['connection'] = 'not_connected';
    let providerAccountLast4 = '';
    if (!identityReview) {
      try {
        const metadata = await loadMercadoPagoStoreConnectionMetadata(ownerId);
        if (metadata?.status === 'connected' && metadata.externalAccountId) {
          connection = 'connected';
          providerAccountLast4 = metadata.externalAccountId.slice(-4);
        }
      } catch {
        connection = 'review'; // Malformed data must never imply ready.
      }
    }
    const readiness: MerchantPixInventoryReadiness = identityReview ? 'identity_review'
      : connection === 'review' ? 'connection_review'
      : connection !== 'connected' ? 'oauth_required'
      : isMercadoPagoMerchantPixRolloutAllowed(canonicalStoreId, env)
        ? 'oauth_connected_rollout_enabled'
        : 'oauth_connected_rollout_pending';

    return {
      canonicalStoreId,
      tenantId,
      storeName,
      publicationStatus: 'published' as const,
      connection,
      providerAccountLast4,
      readiness,
      needsLivePreflight: true as const,
    };
  }));

  return {
    generatedAt: new Date().toISOString(),
    source: 'published_tenants',
    scanned: items.length,
    complete,
    requiresOperationalSalesReview: true,
    rolloutMode: rolloutMode(env),
    items,
    warnings: [
      ...(!complete ? ['Mais de 50 lojas publicadas: inventário parcial. Não autorize o merge.'] : []),
      'Lojas publicadas não representam necessariamente todas as lojas com Pix em aberto. Verifique também pedidos e cobranças históricas antes do merge.',
      'Status conectado é metadado, não substitui validação OAuth ao vivo, conta recebedora ou teste de pagamento.',
    ],
  };
};
