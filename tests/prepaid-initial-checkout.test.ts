import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { build } from "esbuild";
const hash = (x: string) => createHash("sha256").update(x).digest("hex");
let docs: Map<string, any>, posts: number, lose: boolean;
const modality = {
  schemaVersion: 1,
  mode: "subscription",
  subscription: {
    schemaVersion: 1,
    autoRenew: true,
    billingInterval: { unit: "month", count: 1 },
    benefit: { kind: "access", unitsPerCycle: null },
  },
};
const product = () => ({
  name: "Published",
  price: 10,
  publicationStatus: "published",
  saleModality: modality,
  contractDiscounts: [
    { months: 1, discountPercent: 0 },
    { months: 3, discountPercent: 0 },
    { months: 6, discountPercent: 0 },
    { months: 12, discountPercent: 0 },
  ],
});
const snap = (path: string) => ({
  exists: docs.has(path),
  data: () => docs.get(path),
  get: (key: string) => docs.get(path)?.[key],
});
const db = {
  doc: (path: string) => ({
    path,
    get: async () => snap(path),
    update: async (data: any) => docs.set(path, { ...docs.get(path), ...data }),
  }),
  runTransaction: async (fn: any) =>
    fn({
      get: async (r: any) => snap(r.path),
      create: (r: any, d: any) => {
        assert(!docs.has(r.path));
        docs.set(r.path, d);
      },
      set: (r: any, d: any) => docs.set(r.path, d),
      update: (r: any, d: any) =>
        docs.set(r.path, { ...docs.get(r.path), ...d }),
    }),
};
(globalThis as any).__initial = {
  db,
  hash,
  auth: async (a: string) => {
    if (!a) throw Error("AUTH_REQUIRED");
    return { uid: a, email: a + "@example.test", emailVerified: true };
  },
  quote: async (i: any) => ({
    quote: {
      months: i.selectedMonths,
      discountPercent: 0,
      totalMinor: 1000 * i.selectedMonths,
      monthlyEquivalentMinor: 1000,
    },
  }),
  mp: async (_scope: string, path: string, init: any) => {
    if (init?.method === "POST") {
      posts++;
      const d = {
        ...JSON.parse(init.body),
        id: "123",
        collector_id: "42",
        currency_id: "BRL",
        status: "pending",
        point_of_interaction: { transaction_data: { qr_code: "PIX-TEST" } },
      };
      docs.set("payment", d);
      if (lose) throw Error("LOST");
      return d;
    }
    if (path.includes("search?"))
      return {
        paging: { total: 1, offset: 0, limit: 2 },
        results: [docs.get("payment")],
      };
    return docs.get("payment");
  },
};
const output = await build({
  entryPoints: ["server/payments/initialPrepaidSubscriptionCheckout.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [
    {
      name: "isolated",
      setup(b) {
        b.onResolve(
          {
            filter:
              /mercadoPagoPixProvider\.js$|firebaseAdmin\.js$|consultantAuth\.js$|persistedMerchantSubscriptionQuote\.js$|canonicalStoreIdentityService\.js$|commercialRecipientAuthorityService\.js$|mercadoPagoStoreOauthService\.js$|prepaidRenewalPaymentVerification\.js$|persistedInitialPrepaidSubscription\.js$/,
          },
          (a) => ({ path: a.path, namespace: "mock" }),
        );
        b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({
          contents: a.path.endsWith("mercadoPagoPixProvider.js") ? `export const verifyMercadoPagoWebhookSignature=async input=>{if(input.headers["x-test-signature"]!=="signed")throw Error("INVALID_SIGNATURE")}` : a.path.endsWith("firebaseAdmin.js")
            ? "export const adminDb=globalThis.__initial.db"
            : a.path.endsWith("consultantAuth.js")
              ? "export const authenticateConsultantRequest=globalThis.__initial.auth"
              : a.path.endsWith("persistedMerchantSubscriptionQuote.js")
                ? "export const quotePersistedMerchantSubscription=globalThis.__initial.quote"
                : a.path.endsWith("canonicalStoreIdentityService.js")
                  ? "export const resolveCanonicalStoreIdentity=async()=>({canonicalStoreId:'store',ownerUserId:'owner',legacyStoreId:'owner'})"
                  : a.path.endsWith("commercialRecipientAuthorityService.js")
                    ? "export const resolveCommercialRecipientAuthority=async()=>({recipientKind:'merchant_store',credentialScopeId:'owner',externalAccountId:'42'})"
                    : a.path.endsWith("mercadoPagoStoreOauthService.js")
                      ? "export const getValidMercadoPagoStoreAccessToken=async()=>({externalAccountId:'42'});export const mercadoPagoStoreRequest=globalThis.__initial.mp"
                      : a.path.endsWith("prepaidRenewalPaymentVerification.js")
                        ? 'export const verifyPrepaidRenewalMercadoPagoPayment=async()=>{throw Error("NOT_APPROVED")}'
                        : `export const persistInitialPrepaidSubscription=async()=>{throw Error('NO_ACTIVATION_FOR_PENDING')};export const initialPrepaidCommercialDigest=d=>globalThis.__initial.hash(JSON.stringify({storeId:d.storeId,buyerId:d.buyerId,productId:d.productId,ownerUserId:d.ownerUserId,legacyStoreId:d.legacyStoreId,productName:d.productName,saleModality:d.saleModality,monthlyBasePriceMinor:d.monthlyBasePriceMinor,quote:d.quote}));`,
        }));
      },
    },
  ],
});
const api = await import(
  "data:text/javascript;base64," +
    Buffer.from(output.outputFiles[0].text).toString("base64")
);
beforeEach(() => {
  docs = new Map<string, any>([
    ["stores/store", { ownerId: "owner" }],
    [
      "stores/owner/paymentProviderConnections/mercado_pago",
      { status: "connected", externalAccountId: "42" },
    ],
    ["stores/store/products/product", product()],
  ]);
  posts = 0;
  lose = false;
  process.env.KYRUB_INITIAL_PREPAID_PIX_CHECKOUT_ENABLED = "true";
});
async function quote(months = 3) {
  return api.quoteInitialPrepaidSubscription({
    authorization: "buyer",
    storeId: "store",
    productId: "product",
    months,
  });
}
for (const months of [3, 6, 12])
  test(`server frozen quote ${months} months and explicit acceptance`, async () => {
    const q = await quote(months);
    assert.equal(q.quote.totalMinor, months * 1000);
    const input = {
      authorization: "buyer",
      storeId: "store",
      checkoutId: q.checkoutId,
    };
    await assert.rejects(
      api.acceptInitialPrepaidSubscription({ ...input, acceptedTotalMinor: 1 }),
    );
    await api.acceptInitialPrepaidSubscription({
      ...input,
      acceptedTotalMinor: q.quote.totalMinor,
    });
    assert.equal(
      (await api.checkoutInitialPrepaidSubscription(input)).state,
      "awaiting_payment",
    );
    assert.equal(posts, 1);
    await api.checkoutInitialPrepaidSubscription(input);
    assert.equal(posts, 1);
  });
test("unpublished product transaction rejects quote", async () => {
  docs.get("stores/store/products/product").publicationStatus = "draft";
  await assert.rejects(quote());
  assert.equal(posts, 0);
});
test("lost response is recovered by GET without duplicate POST", async () => {
  const q = await quote();
  const i = {
    authorization: "buyer",
    storeId: "store",
    checkoutId: q.checkoutId,
  };
  await api.acceptInitialPrepaidSubscription({
    ...i,
    acceptedTotalMinor: 3000,
  });
  lose = true;
  assert.equal(
    (await api.checkoutInitialPrepaidSubscription(i)).state,
    "recovery_required",
  );
  assert.equal(
    (await api.reconcileInitialPrepaidSubscription(i)).state,
    "awaiting_payment",
  );
  assert.equal(posts, 1);
});
test("checkout flag and cross-buyer access fail closed", async () => {
  const q = await quote();
  delete process.env.KYRUB_INITIAL_PREPAID_PIX_CHECKOUT_ENABLED;
  await assert.rejects(
    api.checkoutInitialPrepaidSubscription({
      authorization: "buyer",
      storeId: "store",
      checkoutId: q.checkoutId,
    }),
  );
  await assert.rejects(
    api.acceptInitialPrepaidSubscription({
      authorization: "other",
      storeId: "store",
      checkoutId: q.checkoutId,
      acceptedTotalMinor: 3000,
    }),
  );
  assert.equal(posts, 0);
});

 test('unsigned webhook cannot reconcile a bound payment', async()=>{const q=await quote();await assert.rejects(api.handleInitialPrepaidSubscriptionWebhook({headers:{},dataId:'123',storeId:'store',checkoutId:q.checkoutId}),/INVALID_SIGNATURE/);assert.equal(posts,0)});
 test('signed repeated pending webhook never activates or creates a payment',async()=>{const q=await quote();const i={authorization:'buyer',storeId:'store',checkoutId:q.checkoutId};await api.acceptInitialPrepaidSubscription({...i,acceptedTotalMinor:3000});await api.checkoutInitialPrepaidSubscription(i);const hook={headers:{'x-test-signature':'signed'},dataId:'123',storeId:'store',checkoutId:q.checkoutId};assert.equal((await api.handleInitialPrepaidSubscriptionWebhook(hook)).state,'awaiting_payment');assert.equal((await api.handleInitialPrepaidSubscriptionWebhook(hook)).state,'awaiting_payment');assert.equal(posts,1);assert.equal((await api.handleInitialPrepaidSubscriptionWebhook({...hook,dataId:'999'})).processed,false)});
 test('reopening a different term resumes the original paid attempt',async()=>{const q=await quote(3);const i={authorization:'buyer',storeId:'store',checkoutId:q.checkoutId};await api.acceptInitialPrepaidSubscription({...i,acceptedTotalMinor:3000});await api.checkoutInitialPrepaidSubscription(i);const resumed=await quote(12);assert.equal(resumed.checkoutId,q.checkoutId);assert.equal(resumed.quote.months,3);assert.equal(posts,1)});

test('notification URL reuses HTTPS configured origin and exact signed handler locator',()=>{const previous=process.env.KYRUB_STORE_SUBSCRIPTION_WEBHOOK_URL;process.env.KYRUB_STORE_SUBSCRIPTION_WEBHOOK_URL='https://test.example/api/other?op=wrong';try {const u=new URL(api.initialPrepaidWebhookUrl('store','a'.repeat(64)));assert.equal(u.origin,'https://test.example');assert.equal(u.pathname,'/api/plan-control');assert.equal(u.searchParams.get('op'),'merchant.prepaid-initial.webhook');assert.equal(u.searchParams.get('storeId'),'store');assert.equal(u.searchParams.get('checkoutId'),'a'.repeat(64));process.env.KYRUB_STORE_SUBSCRIPTION_WEBHOOK_URL='http://test.example';assert.throws(()=>api.initialPrepaidWebhookUrl('store','a'.repeat(64)));}finally{if(previous===undefined)delete process.env.KYRUB_STORE_SUBSCRIPTION_WEBHOOK_URL;else process.env.KYRUB_STORE_SUBSCRIPTION_WEBHOOK_URL=previous;}});

test('initial quote refuses references that the shared provider verifier cannot verify', async () => {
  await assert.rejects(api.quoteInitialPrepaidSubscription({ authorization: 'buyer', storeId: 's'.repeat(128), productId: 'product', months: 3 }), /INVALID_INITIAL_PREPAID_REQUEST/);
  assert.equal(posts, 0);
});
