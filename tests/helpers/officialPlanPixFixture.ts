import { build } from 'esbuild';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';

/** Only external identity/provider boundaries are replaced; commercial services stay real. */
export async function loadOfficialPlanPixFixture() {
  const previousFetch = globalThis.fetch;
  process.env.KYRUB_BILLING_MERCADO_PAGO_ACCESS_TOKEN = 'isolated-platform-token';
  process.env.KYRUB_BILLING_MERCADO_PAGO_WEBHOOK_SECRET = 'isolated-platform-secret';
  globalThis.fetch = (async (url: any, init: any) => {
    const target = new URL(String(url));
    if (target.origin !== 'https://api.mercadopago.com') throw Error('UNEXPECTED_NETWORK');
    return Response.json(await (globalThis as any).__officialPix.request(target.pathname + target.search, init));
  }) as typeof fetch;
  const bundle = await build({ entryPoints: ['server/payments/officialPlanPixCheckout.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
    packages: 'external', plugins: [{ name: 'isolated-platform', setup(b) {
      b.onResolve({ filter: /firebaseAdmin\.js$|consultantAuth\.js$|paidPlanSubscriptionService\.js$|officialStoreService\.js$|publicPlanCatalogService\.js$|canonicalStoreIdentityService\.js$|mercadoPagoStoreOauthService\.js$|mercadoPagoStoreConnectionSecretStore\.js$/ }, a => ({ path: a.path, namespace: 'mock' }));
      b.onLoad({ filter: /.*/, namespace: 'mock' }, a => ({ contents:
        a.path.endsWith('firebaseAdmin.js') ? 'export const adminDb=globalThis.__officialPix.db;export const getFirebaseAdminAccessToken=()=>{throw Error("UNEXPECTED_NETWORK")};' :
        a.path.endsWith('consultantAuth.js') ? 'export const authenticateConsultantRequest=globalThis.__officialPix.auth;export const verifyFirebaseIdToken=authenticateConsultantRequest;' :
        a.path.endsWith('paidPlanSubscriptionService.js') ? `export const platformBillingRequest=globalThis.__officialPix.request;
          export const writePlanMirrors=(tx,buyer,storeId,plan,now)=>{ for(const path of ['users/'+buyer+'/stores/'+buyer,'tenants/'+buyer,'stores/'+storeId]) tx.set(globalThis.__officialPix.db.doc(path),{plan,updatedAt:now},{merge:true}); };` :
        a.path.endsWith('officialStoreService.js') ? `export const getOfficialStoreIdentity=async()=>({canonicalStoreId:'official-store',ownerUserId:'owner',legacyStoreId:'owner'});` :
        a.path.endsWith('publicPlanCatalogService.js') ? `export const loadPublicActivePlanCatalog=async()=>({plans:[{planId:'pro',version:4},{planId:'business',version:4}]});` :
        a.path.endsWith('canonicalStoreIdentityService.js') ? `export const resolveCanonicalStoreIdentity=async(store)=>({canonicalStoreId:store,ownerUserId:'owner',legacyStoreId:'owner'});` :
        a.path.endsWith('mercadoPagoStoreConnectionSecretStore.js') ? `export const loadMercadoPagoStoreConnectionMetadata=async(scope)=>{if(scope!=='owner')throw Error('WRONG_OAUTH_SCOPE');return {status:'connected',externalAccountId:'42'};};` :
        `export const mercadoPagoStoreRequest=async()=>{throw Error('MERCHANT_OAUTH_FORBIDDEN')}; export const getValidMercadoPagoStoreAccessToken=mercadoPagoStoreRequest;
          export const validateMercadoPagoStoreConnection=async(scope)=>{if(scope!=='owner')throw Error('WRONG_OAUTH_SCOPE');return '42';};` }));
    } }],
  });
  const bundlePath = new URL(`../.official-plan-pix-${randomUUID()}.mjs`, import.meta.url);
  await writeFile(bundlePath, bundle.outputFiles[0].text);
  try { return { ...await import(bundlePath.href), restoreFixture: () => { globalThis.fetch = previousFetch; } }; }
  finally { await unlink(bundlePath); }
}
