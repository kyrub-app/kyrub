import { verifyMercadoPagoWebhookSignature } from "./mercadoPagoPixProvider.js";
import { createHash } from "node:crypto";
import { adminDb } from "../firebaseAdmin.js";
import { authenticateConsultantRequest } from "../ai/consultantAuth.js";
import { resolveSubscriptionContractQuote } from "./subscriptionContractQuote.js";
import { quotePersistedMerchantSubscription } from "./persistedMerchantSubscriptionQuote.js";
import { resolveCanonicalStoreIdentity } from "../identity/canonicalStoreIdentityService.js";
import { resolveCommercialRecipientAuthority } from "./commercialRecipientAuthorityService.js";
import {
  getValidMercadoPagoStoreAccessToken,
  mercadoPagoStoreRequest,
} from "../integrations/mercadoPagoStoreOauthService.js";
import { verifyPrepaidRenewalMercadoPagoPayment } from "./prepaidRenewalPaymentVerification.js";
import type { ContractTermMonths } from "../../shared/subscriptionContractOffers.js";
import {
  initialPrepaidCommercialDigest,
  persistInitialPrepaidSubscription,
} from "./persistedInitialPrepaidSubscription.js";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const valid = (s: unknown): s is string =>
  typeof s === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(s);
const ref = (store: string, id: string) =>
  adminDb.doc(`stores/${store}/prepaidSubscriptionCheckouts/${id}`);
const gate = () => {
  if (process.env.KYRUB_INITIAL_PREPAID_PIX_CHECKOUT_ENABLED !== "true")
    throw Error("INITIAL_PREPAID_CHECKOUT_DISABLED");
};
export const quoteInitialPrepaidSubscription = async (input: {
  authorization: string;
  storeId: string;
  productId: string;
  months: ContractTermMonths;
}) => {
  const buyer = await authenticateConsultantRequest(input.authorization);
  if (
    !valid(input.storeId) ||
    reference(input.storeId, "0".repeat(64)).length > 180 ||
    !valid(input.productId) ||
    ![3, 6, 12].includes(input.months)
  )
    throw Error("INVALID_INITIAL_PREPAID_REQUEST");
  const existingSlot = await adminDb
    .doc(
      `stores/${input.storeId}/subscriptionCheckoutSlots/${hash(`${buyer.uid}:${input.productId}`)}`,
    )
    .get();
  const priorId = existingSlot.get("checkoutId");
  if (typeof priorId === "string" && /^[a-f0-9]{64}$/.test(priorId)) {
    const prior = (await ref(input.storeId, priorId).get()).data();
    if (
      !prior ||
      prior.buyerId !== buyer.uid ||
      prior.productId !== input.productId ||
      prior.storeId !== input.storeId ||
      prior.quoteDigest !== initialPrepaidCommercialDigest(prior)
    )
      throw Error("INITIAL_PREPAID_INTENT_CHANGED");
    return { checkoutId: priorId, quote: prior.quote, status: prior.status };
  }
  const identity = await resolveCanonicalStoreIdentity(input.storeId, {
    requirePublishedTenant: true,
  });
  if (identity.canonicalStoreId !== input.storeId)
    throw Error("INVALID_INITIAL_PREPAID_STORE");
  const result = await quotePersistedMerchantSubscription({
    sellerStoreReference: input.storeId,
    productId: input.productId,
    selectedMonths: input.months,
    paymentTerms: { collectionMode: "prepaid", installments: 1 },
  });
  if (result.quote.totalMinor <= 0)
    throw Error("INVALID_INITIAL_PREPAID_AMOUNT");
  const product = (
    await adminDb
      .doc(`stores/${input.storeId}/products/${input.productId}`)
      .get()
  ).data();
  if (typeof product?.name !== "string" || !product.name.trim() || product.name.length > 240)
    throw Error("INVALID_INITIAL_PREPAID_PRODUCT");
  const snapshot = {
    storeId: input.storeId,
    buyerId: buyer.uid,
    productId: input.productId,
    ownerUserId: identity.ownerUserId,
    legacyStoreId: identity.legacyStoreId,
    productName: product?.name,
    saleModality: product?.saleModality,
    monthlyBasePriceMinor: Math.round(product?.price * 100),
    quote: result.quote,
  };
  const confirmed = resolveSubscriptionContractQuote({
    persistedSaleModality: product?.saleModality,
    authoritativeMonthlyPriceMinor: snapshot.monthlyBasePriceMinor,
    persistedOffers: product?.contractDiscounts,
    selectedMonths: input.months,
    paymentTerms: { collectionMode: "prepaid", installments: 1 },
  });
  if (JSON.stringify(confirmed) !== JSON.stringify(result.quote))
    throw Error("INITIAL_PREPAID_PRODUCT_CHANGED");
  const checkoutId = initialPrepaidCommercialDigest(snapshot);
  await adminDb.runTransaction(async (tx) => {
    const r = ref(input.storeId, checkoutId),
      [old, currentProduct, currentStore] = await Promise.all([
        tx.get(r),
        tx.get(
          adminDb.doc(`stores/${input.storeId}/products/${input.productId}`),
        ),
        tx.get(adminDb.doc(`stores/${input.storeId}`)),
      ]);
    if (
      currentProduct.get("publicationStatus") !== "published" ||
      JSON.stringify(currentProduct.data()) !== JSON.stringify(product) ||
      currentStore.get("ownerId") !== identity.ownerUserId
    )
      throw Error("INITIAL_PREPAID_PRODUCT_CHANGED");
    if (!old.exists)
      tx.create(r, {
        ...snapshot,
        checkoutId,
        status: "quoted",
        quotedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        quoteDigest: checkoutId,
      });
  });
  return {
    checkoutId,
    quote: result.quote,
    status: (await ref(input.storeId, checkoutId).get()).get("status"),
  };
};
async function load(input: {
  authorization: string;
  storeId: string;
  checkoutId: string;
}) {
  if (!valid(input.storeId) || !/^[a-f0-9]{64}$/.test(input.checkoutId))
    throw Error("INVALID_INITIAL_PREPAID_REQUEST");
  const buyer = await authenticateConsultantRequest(input.authorization);
  const r = ref(input.storeId, input.checkoutId);
  const d = (await r.get()).data();
  if (
    !d ||
    d.buyerId !== buyer.uid ||
    d.storeId !== input.storeId ||
    d.quoteDigest !== initialPrepaidCommercialDigest(d)
  )
    throw Error("INITIAL_PREPAID_FORBIDDEN");
  return { buyer, r, d };
}
export const acceptInitialPrepaidSubscription = async (input: {
  authorization: string;
  storeId: string;
  checkoutId: string;
  acceptedTotalMinor: number;
}) => {
  const { buyer, r } = await load(input);
  return adminDb.runTransaction(async (tx) => {
    const d = (await tx.get(r)).data();
    if (
      !d ||
      d.buyerId !== buyer.uid ||
      d.quote?.totalMinor !== input.acceptedTotalMinor
    )
      throw Error("INITIAL_PREPAID_ACCEPTANCE_REQUIRED");
    if (d.acceptedAt) return { status: "already_accepted" };
    if (d.status !== "quoted")
      throw Error("INITIAL_PREPAID_ACCEPTANCE_REQUIRED");
    const acceptedAt = new Date().toISOString();
    tx.update(r, {
      status: "accepted",
      acceptedBy: buyer.uid,
      acceptedQuoteDigest: d.quoteDigest,
      acceptedAt,
      acceptedTotalMinor: input.acceptedTotalMinor,
      expiresAt: new Date(Date.parse(acceptedAt) + 30 * 60000).toISOString(),
    });
    return { status: "accepted" };
  });
};
async function recipient(storeId: string) {
  const a = await resolveCommercialRecipientAuthority({
    context: "store_subscription",
    canonicalStoreId: storeId,
  });
  const token = await getValidMercadoPagoStoreAccessToken(a.credentialScopeId);
  if (
    a.recipientKind !== "merchant_store" ||
    token.externalAccountId !== a.externalAccountId
  )
    throw Error("INITIAL_PREPAID_SELLER_CHANGED");
  return a;
}
const reference = (store: string, id: string) =>
  `kyrub:initial-prepaid:${store}:${id}`;
function validate(payment: any, d: any, a: any) {
  const cents = payment?.transaction_amount * 100;
  if (
    !/^\d{1,32}$/.test(String(payment?.id)) ||
    payment.currency_id !== "BRL" ||
    payment.payment_method_id !== "pix" ||
    String(payment.collector_id) !== a.externalAccountId ||
    payment.external_reference !== reference(d.storeId, d.checkoutId) ||
    !Number.isSafeInteger(Math.round(cents)) ||
    Math.abs(cents - Math.round(cents)) > 1e-6 ||
    Math.round(cents) !== d.quote.totalMinor
  )
    throw Error("INITIAL_PREPAID_PAYMENT_MISMATCH");
}
async function bindPayment(r: FirebaseFirestore.DocumentReference, d: any, a: any, id: string) {
  await adminDb.runTransaction(async (tx) => {
    const [current, store, connection] = await Promise.all([
      tx.get(r),
      tx.get(adminDb.doc(`stores/${d.storeId}`)),
      tx.get(
        adminDb.doc(
          `stores/${a.credentialScopeId}/paymentProviderConnections/mercado_pago`,
        ),
      ),
    ]);
    if (
      current.get("buyerId") !== d.buyerId ||
      current.get("acceptedQuoteDigest") !== d.acceptedQuoteDigest ||
      current.get("requestDigest") !== d.requestDigest ||
      store.get("ownerId") !== a.credentialScopeId ||
      connection.get("status") !== "connected" ||
      connection.get("externalAccountId") !== a.externalAccountId
    )
      throw Error("INITIAL_PREPAID_SELLER_CHANGED");
    if (
      current.get("providerPaymentId") &&
      current.get("providerPaymentId") !== id
    )
      throw Error("INITIAL_PREPAID_PAYMENT_CONFLICT");
    tx.update(r, { providerPaymentId: id, status: current.get("status") === "activated" ? "activated" : "bound" });
  });
}
export const reconcileInitialPrepaidSubscription = async (input: {
  authorization: string;
  storeId: string;
  checkoutId: string;
}) => {
  return reconcileLoadedInitialPrepaidSubscription(input, await load(input));
};
async function reconcileLoadedInitialPrepaidSubscription(
  input: { authorization: string; storeId: string; checkoutId: string },
  loaded: Awaited<ReturnType<typeof load>>,
) {
  const { r, d } = loaded;
  if (!d.acceptedAt) throw Error("INITIAL_PREPAID_ACCEPTANCE_REQUIRED");
  const a = await recipient(input.storeId);
  let id = d.providerPaymentId;
  if (!id && ["in_flight", "outcome_unknown"].includes(d.status)) {
    const params = new URLSearchParams({
      external_reference: reference(input.storeId, input.checkoutId),
      limit: "2",
      offset: "0",
    });
    const found = await mercadoPagoStoreRequest<any>(
      a.credentialScopeId,
      `/v1/payments/search?${params}`,
      { method: "GET" },
    );
    if (
      found?.paging?.total !== 1 ||
      found.paging.offset !== 0 ||
      found.paging.limit !== 2 ||
      found.results?.length !== 1
    )
      return { state: "recovery_required" };
    validate(found.results[0], d, a);
    id = String(found.results[0].id);
    const detail = await mercadoPagoStoreRequest<any>(
      a.credentialScopeId,
      `/v1/payments/${id}`,
      { method: "GET" },
    );
    validate(detail, d, a);
    if (String(detail.id) !== id) throw Error("INITIAL_PREPAID_PAYMENT_MISMATCH");
    const latestSeller = await recipient(input.storeId);
    if (
      latestSeller.credentialScopeId !== a.credentialScopeId ||
      latestSeller.externalAccountId !== a.externalAccountId
    )
      throw Error("INITIAL_PREPAID_SELLER_CHANGED");
    await bindPayment(r, d, a, id);
  }
  if (!id) return { state: "recovery_required" };
  const payment = await mercadoPagoStoreRequest<any>(
    a.credentialScopeId,
    `/v1/payments/${id}`,
    { method: "GET" },
  );
  validate(payment, d, a);
  if (String(payment.id) !== id) throw Error("INITIAL_PREPAID_PAYMENT_MISMATCH");
  const current = await recipient(input.storeId);
  if (
    current.externalAccountId !== a.externalAccountId ||
    current.credentialScopeId !== a.credentialScopeId
  )
    throw Error("INITIAL_PREPAID_SELLER_CHANGED");
  if (payment.status === "approved") {
    const verified = await verifyPrepaidRenewalMercadoPagoPayment({
      sellerCredentialScopeId: a.credentialScopeId,
      paymentId: id,
      expectedExternalReference: reference(input.storeId, input.checkoutId),
      expectedAmountMinor: d.quote.totalMinor,
    });
    if (Date.parse(verified.occurredAt) < Date.parse(d.acceptedAt))
      throw Error("INITIAL_PREPAID_PAYMENT_PRECEDES_ACCEPTANCE");
    const result = await persistInitialPrepaidSubscription({
      storeId: input.storeId,
      checkoutId: input.checkoutId,
      authenticatedBuyerId: d.buyerId,
      payment: verified,
      seller: {
        credentialScopeId: a.credentialScopeId,
        externalAccountId: a.externalAccountId,
      },
    });
    return { state: "activated", ...result };
  }
  if (!["pending", "in_process"].includes(payment.status))
    return { state: "rejected", paymentId: id };
  const qr = payment.point_of_interaction?.transaction_data?.qr_code;
  if (typeof qr !== "string" || !qr.trim() || qr.length > 10000 || Date.parse(d.expiresAt) <= Date.now())
    return { state: "recovery_required", paymentId: id };
  return {
    state: "awaiting_payment",
    paymentId: id,
    pix: {
      qrCode:
        typeof payment.point_of_interaction?.transaction_data?.qr_code ===
        "string"
          ? payment.point_of_interaction.transaction_data.qr_code
          : "",
      expiresAt: d.expiresAt,
    },
  };
}
export const initialPrepaidWebhookUrl = (storeId: string, checkoutId: string): string => {
  const configured = process.env.KYRUB_STORE_SUBSCRIPTION_WEBHOOK_URL?.trim() || "https://kyrub.com/api/plan-control";
  const url = new URL(configured);
  if (url.protocol !== "https:") throw Error("INITIAL_PREPAID_WEBHOOK_URL_INVALID");
  url.pathname = "/api/plan-control";
  url.search = "";
  url.hash = "";
  url.searchParams.set("op", "merchant.prepaid-initial.webhook");
  url.searchParams.set("storeId", storeId);
  url.searchParams.set("checkoutId", checkoutId);
  return url.toString();
};
export const checkoutInitialPrepaidSubscription = async (input: {
  authorization: string;
  storeId: string;
  checkoutId: string;
}) => {
  gate();
  const { buyer, r, d } = await load(input);
  if (d.status !== "accepted")
    return reconcileInitialPrepaidSubscription(input);
  if (
    d.acceptedBy !== buyer.uid ||
    d.acceptedTotalMinor !== d.quote.totalMinor ||
    Date.parse(d.expiresAt) <= Date.now() ||
    !buyer.email ||
    buyer.emailVerified === false
  )
    throw Error("INITIAL_PREPAID_ACCEPTANCE_REQUIRED");
  const fresh = await quotePersistedMerchantSubscription({
    sellerStoreReference: input.storeId,
    productId: d.productId,
    selectedMonths: d.quote.months,
    paymentTerms: { collectionMode: "prepaid", installments: 1 },
  });
  if (JSON.stringify(fresh.quote) !== JSON.stringify(d.quote))
    throw Error("INITIAL_PREPAID_PRODUCT_CHANGED");
  const a = await recipient(input.storeId);
  const body = JSON.stringify({
    transaction_amount: d.quote.totalMinor / 100,
    payment_method_id: "pix",
    payer: { email: buyer.email },
    description: d.productName,
    notification_url: initialPrepaidWebhookUrl(input.storeId,input.checkoutId),
    date_of_expiration: d.expiresAt,
    external_reference: reference(input.storeId, input.checkoutId),
  });
  const slot = adminDb.doc(
    `stores/${input.storeId}/subscriptionCheckoutSlots/${hash(`${buyer.uid}:${d.productId}`)}`,
  );
  await adminDb.runTransaction(async (tx) => {
    const [current, lock, product, store, mapping] = await Promise.all([
      tx.get(r),
      tx.get(slot),
      tx.get(adminDb.doc(`stores/${input.storeId}/products/${d.productId}`)),
      tx.get(adminDb.doc(`stores/${input.storeId}`)),
      tx.get(
        adminDb.doc(
          `kyrub_admin/control_plane/official_plan_products/${d.productId}`,
        ),
      ),
    ]);
    const p = product.data();
    if (
      !p ||
      p.publicationStatus !== "published" ||
      mapping.exists ||
      store.get("ownerId") !== d.ownerUserId ||
      store.get("ownerId") !== a.credentialScopeId ||
      p.name !== d.productName ||
      JSON.stringify(p.saleModality) !== JSON.stringify(d.saleModality) ||
      Math.round(p.price * 100) !== d.monthlyBasePriceMinor ||
      JSON.stringify(
        resolveSubscriptionContractQuote({
          persistedSaleModality: p.saleModality,
          authoritativeMonthlyPriceMinor: Math.round(p.price * 100),
          persistedOffers: p.contractDiscounts,
          selectedMonths: d.quote.months,
          paymentTerms: { collectionMode: "prepaid", installments: 1 },
        }),
      ) !== JSON.stringify(d.quote) ||
      current.get("quoteDigest") !== d.quoteDigest ||
      current.get("acceptedQuoteDigest") !== d.quoteDigest
    )
      throw Error("INITIAL_PREPAID_PRODUCT_CHANGED");
    if (
      current.get("status") !== "accepted" ||
      (lock.exists && lock.get("checkoutId") !== input.checkoutId)
    )
      throw Error("INITIAL_PREPAID_CHECKOUT_IN_PROGRESS");
    tx.set(slot, { checkoutId: input.checkoutId, state: "prepaid_in_flight" });
    tx.update(r, {
      status: "in_flight",
      requestBody: body,
      sellerCredentialScopeId: a.credentialScopeId,
      credentialScopeId: a.credentialScopeId,
      externalAccountId: a.externalAccountId,
      requestDigest: hash(body),
    });
  });
  try {
    gate();
    const latest = await recipient(input.storeId);
    if (
      latest.externalAccountId !== a.externalAccountId ||
      latest.credentialScopeId !== a.credentialScopeId
    )
      throw Error("INITIAL_PREPAID_SELLER_CHANGED");
    const p = await mercadoPagoStoreRequest<any>(
      a.credentialScopeId,
      "/v1/payments",
      {
        method: "POST",
        headers: { "X-Idempotency-Key": `initial-prepaid-${input.checkoutId}` },
        body,
      },
    );
    validate(p, d, a);
    await bindPayment(r, { ...d, requestDigest: hash(body) }, a, String(p.id));
  } catch {
    await adminDb.runTransaction(async tx => {
      const current = await tx.get(r);
      if (!current.get("providerPaymentId") && current.get("status") === "in_flight")
        tx.update(r, { status: "outcome_unknown" });
    });
    return { state: "recovery_required" };
  }
  return reconcileInitialPrepaidSubscription(input);
};

/** Signed notifications only reconcile an already bound payment; lost responses use buyer recovery. */
export const handleInitialPrepaidSubscriptionWebhook = async (input: {
  headers: Record<string, string | string[] | undefined>;
  dataId: string;
  storeId: string;
  checkoutId: string;
}) => {
  await verifyMercadoPagoWebhookSignature({
    headers: input.headers,
    dataId: input.dataId,
  });
  if (
    !valid(input.storeId) ||
    !/^[a-f0-9]{64}$/.test(input.checkoutId) ||
    !/^\d{1,32}$/.test(input.dataId)
  )
    throw Error("INVALID_INITIAL_PREPAID_WEBHOOK");
  const r = ref(input.storeId, input.checkoutId);
  const d = (await r.get()).data();
  if (
    !d ||
    d.providerPaymentId !== input.dataId ||
    !d.acceptedAt ||
    d.acceptedBy !== d.buyerId ||
    d.quoteDigest !== initialPrepaidCommercialDigest(d)
  )
    return { processed: false };
  const result = await reconcileLoadedInitialPrepaidSubscription(
    { authorization: "", storeId: input.storeId, checkoutId: input.checkoutId },
    { r, d, buyer: { uid: d.buyerId, email: "", name: "" } },
  );
  return { processed: true, ...result };
};
