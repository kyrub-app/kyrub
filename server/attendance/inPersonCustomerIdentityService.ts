import { FieldValue, type DocumentData } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  isPaymentAuthoritativelyPaid,
  normalizeCanonicalPayment,
  type CanonicalPayment,
} from '../../src/utils/canonicalPayment.js';
import {
  isDirectStaffLinkAllowed,
  maskCustomerEmail,
  maskCustomerPhone,
  parseInPersonCustomerLinkInput,
  parseInPersonCustomerLookupInput,
  phoneLookupVariants,
  type InPersonCustomerCandidate,
  type InPersonCustomerContext,
  type InPersonCustomerLookupKind,
  type InPersonCustomerPaymentState,
  type InPersonCustomerPaymentSummary,
} from '../../shared/inPersonCustomerIdentity.js';
import { resolveInPersonOrderStoreContext } from './inPersonOrderService.js';

const LOOKUP_TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_CANDIDATES = 8;
const MAX_PAYMENTS_PER_ORDER = 20;

const clean = (value: unknown, max = 240): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, max)
    : '';

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const identityCollection = () => adminDb.collection('identity_verifications');
const usersCollection = () => adminDb.collection('users');
const legacyOrderPath = (storeId: string, orderId: string): string =>
  `artifacts/${storeId}/public/data/customerOrders/${orderId}`;
const canonicalOrderPath = (storeId: string, orderId: string): string =>
  `stores/${storeId}/orders/${orderId}`;
const paymentCollectionPath = (storeId: string): string =>
  `stores/${storeId}/payments`;
const relationshipPath = (storeId: string, customerId: string): string =>
  `stores/${storeId}/customerRelationships/${customerId}`;
const lookupTokenPath = (storeId: string, tokenId: string): string =>
  `stores/${storeId}/customerLookupTokens/${tokenId}`;

const validOrderPaymentStatus = (
  value: unknown
): 'unpaid' | 'partial' | 'paid' =>
  value === 'partial' || value === 'paid' ? value : 'unpaid';

const assertStaffOrder = (value: DocumentData | undefined, orderId: string): DocumentData => {
  if (!value || clean(value.id) !== orderId) {
    throw new Error('IN_PERSON_CUSTOMER_ORDER_NOT_FOUND');
  }
  if (value.source !== 'staff' || value.fulfillmentType !== 'dine_in') {
    throw new Error('IN_PERSON_CUSTOMER_ORDER_NOT_ELIGIBLE');
  }
  if (value.status === 'rejected' || value.status === 'cancelled') {
    throw new Error('IN_PERSON_CUSTOMER_ORDER_CLOSED');
  }
  return value;
};

const nameVariants = (value: string): string[] => {
  const normalized = clean(value, 160);
  const title = normalized
    .toLocaleLowerCase('pt-BR')
    .replace(/(^|\s)\S/g, character => character.toLocaleUpperCase('pt-BR'));
  return [...new Set([
    normalized,
    title,
    normalized.toLocaleUpperCase('pt-BR'),
    normalized.toLocaleLowerCase('pt-BR'),
  ])].filter(Boolean).slice(0, 10);
};

const identityUid = (documentId: string, value: DocumentData): string =>
  clean(value.uid, 180) || clean(documentId, 180);

const loadLookupIdentityDocuments = async (
  kind: InPersonCustomerLookupKind,
  query: string
) => {
  if (kind === 'cpf') {
    return (await identityCollection().where('cpf', '==', query).limit(MAX_CANDIDATES).get()).docs;
  }
  if (kind === 'phone') {
    return (await identityCollection()
      .where('whatsapp', 'in', phoneLookupVariants(query))
      .limit(MAX_CANDIDATES)
      .get()).docs;
  }
  return (await identityCollection()
    .where('fullName', 'in', nameVariants(query))
    .limit(MAX_CANDIDATES)
    .get()).docs;
};

const loadNameUserIds = async (query: string): Promise<string[]> => {
  const variants = nameVariants(query);
  const [displayNameSnapshot, nameSnapshot] = await Promise.all([
    usersCollection().where('displayName', 'in', variants).limit(MAX_CANDIDATES).get(),
    usersCollection().where('name', 'in', variants).limit(MAX_CANDIDATES).get(),
  ]);
  return [...new Set([
    ...displayNameSnapshot.docs.map(document => document.id),
    ...nameSnapshot.docs.map(document => document.id),
  ])].slice(0, MAX_CANDIDATES);
};

const profileDisplayName = (
  profile: DocumentData | undefined,
  identity: DocumentData | undefined,
  uid: string
): string =>
  clean(profile?.displayName, 160) ||
  clean(profile?.name, 160) ||
  clean(identity?.fullName, 160) ||
  `Cairuvi ${uid.slice(0, 6)}`;

const writeLookupTokens = async (input: {
  canonicalStoreId: string;
  legacyStoreId: string;
  orderId: string;
  actorUserId: string;
  kind: InPersonCustomerLookupKind;
  candidates: Array<{
    uid: string;
    displayName: string;
    maskedEmail: string;
    maskedPhone: string;
    identityVerified: boolean;
  }>;
  now: Date;
}): Promise<InPersonCustomerCandidate[]> => {
  const batch = adminDb.batch();
  const expiresAt = new Date(input.now.getTime() + LOOKUP_TOKEN_TTL_MS).toISOString();
  const results = input.candidates.slice(0, MAX_CANDIDATES).map(candidate => {
    const linkable = isDirectStaffLinkAllowed(input.kind, candidate.identityVerified);
    let customerRef = '';
    if (linkable) {
      const reference = adminDb
        .collection(`stores/${input.canonicalStoreId}/customerLookupTokens`)
        .doc();
      customerRef = reference.id;
      batch.create(reference, {
        schemaVersion: 1,
        tokenId: reference.id,
        storeId: input.canonicalStoreId,
        legacyStoreId: input.legacyStoreId,
        orderId: input.orderId,
        customerId: candidate.uid,
        lookupKind: input.kind,
        exactPrivateMatch: true,
        requestedByUserId: input.actorUserId,
        expiresAt,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    return {
      customerRef,
      displayName: candidate.displayName,
      maskedEmail: candidate.maskedEmail,
      maskedPhone: candidate.maskedPhone,
      matchKind: input.kind,
      identityVerified: candidate.identityVerified,
      linkable,
      requiresCustomerConfirmation: !linkable,
    } satisfies InPersonCustomerCandidate;
  });
  if (results.some(candidate => candidate.customerRef)) await batch.commit();
  return results;
};

export const searchInPersonCustomerCandidates = async (input: {
  authenticatedUserId: string;
  value: unknown;
  now?: Date;
}): Promise<{ candidates: InPersonCustomerCandidate[] }> => {
  const request = parseInPersonCustomerLookupInput(input.value);
  const actorUserId = clean(input.authenticatedUserId, 180);
  if (!actorUserId || actorUserId !== request.storeId) {
    throw new Error('IN_PERSON_CUSTOMER_FORBIDDEN');
  }
  const context = await resolveInPersonOrderStoreContext(request.storeId);
  const legacyOrderSnapshot = await adminDb
    .doc(legacyOrderPath(context.legacyStoreId, request.orderId))
    .get();
  assertStaffOrder(legacyOrderSnapshot.data(), request.orderId);

  const identityDocuments = await loadLookupIdentityDocuments(request.kind, request.query);
  const identityByUid = new Map<string, DocumentData>();
  for (const document of identityDocuments) {
    const data = document.data();
    const uid = identityUid(document.id, data);
    if (uid) identityByUid.set(uid, data);
  }

  const candidateIds = new Set<string>(identityByUid.keys());
  if (request.kind === 'name') {
    for (const uid of await loadNameUserIds(request.query)) candidateIds.add(uid);
  }
  const ids = [...candidateIds].slice(0, MAX_CANDIDATES);
  const userSnapshots = ids.length
    ? await adminDb.getAll(...ids.map(uid => adminDb.doc(`users/${uid}`)))
    : [];
  const profileByUid = new Map(
    userSnapshots
      .filter(snapshot => snapshot.exists)
      .map(snapshot => [snapshot.id, snapshot.data() as DocumentData])
  );

  const candidates = ids.flatMap(uid => {
    const profile = profileByUid.get(uid);
    if (!profile) return [];
    const identity = identityByUid.get(uid);
    const identityVerified = identity?.status === 'approved';
    if (request.kind !== 'name' && !identityVerified) return [];
    return [{
      uid,
      displayName: profileDisplayName(profile, identity, uid),
      maskedEmail: maskCustomerEmail(profile.email),
      maskedPhone: identityVerified ? maskCustomerPhone(identity?.whatsapp) : '',
      identityVerified,
    }];
  });

  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('IN_PERSON_CUSTOMER_TIME_INVALID');
  return {
    candidates: await writeLookupTokens({
      canonicalStoreId: context.canonicalStoreId,
      legacyStoreId: context.legacyStoreId,
      orderId: request.orderId,
      actorUserId,
      kind: request.kind,
      candidates,
      now,
    }),
  };
};

const parsePayment = (
  value: DocumentData,
  canonicalStoreId: string,
  orderId: string
): CanonicalPayment | null => {
  try {
    const payment = normalizeCanonicalPayment(value as CanonicalPayment);
    return payment.storeId === canonicalStoreId && payment.orderId === orderId
      ? payment
      : null;
  } catch {
    return null;
  }
};

const paymentSummary = (input: {
  order: DocumentData;
  payments: CanonicalPayment[];
  linkedCustomerId: string;
}): InPersonCustomerPaymentSummary => {
  const expectedAmount = Math.max(0, finite(input.order.total) ?? 0);
  const orderPaymentStatus = validOrderPaymentStatus(input.order.paymentStatus);
  const paidPayments = input.payments.filter(payment =>
    isPaymentAuthoritativelyPaid(payment.status)
  );
  const authoritativelyPaidAmount = Number(
    paidPayments.reduce((sum, payment) => sum + payment.amount, 0).toFixed(2)
  );
  const attributedPaidAmount = Number(
    paidPayments
      .filter(payment => input.linkedCustomerId && payment.buyerId === input.linkedCustomerId)
      .reduce((sum, payment) => sum + payment.amount, 0)
      .toFixed(2)
  );
  const pendingPaymentCount = input.payments.filter(payment => payment.status === 'pending').length;
  const attributedToLinkedCustomer =
    Boolean(input.linkedCustomerId) &&
    attributedPaidAmount + 0.009 >= expectedAmount &&
    expectedAmount > 0;

  let state: InPersonCustomerPaymentState;
  if (input.payments.length === 0) {
    state = orderPaymentStatus === 'unpaid'
      ? 'not_started'
      : 'reconciliation_required';
  } else if (authoritativelyPaidAmount > 0) {
    if (authoritativelyPaidAmount + 0.009 < expectedAmount) {
      state = 'partial';
    } else {
      state = attributedToLinkedCustomer ? 'paid' : 'paid_unattributed';
    }
  } else if (pendingPaymentCount > 0) {
    state = 'pending';
  } else if (input.payments.every(payment => payment.status === 'refunded')) {
    state = 'refunded';
  } else if (orderPaymentStatus !== 'unpaid') {
    state = 'reconciliation_required';
  } else {
    state = 'attention';
  }

  return {
    state,
    orderPaymentStatus,
    expectedAmount: Number(expectedAmount.toFixed(2)),
    authoritativelyPaidAmount,
    pendingPaymentCount,
    paymentCount: input.payments.length,
    attributedToLinkedCustomer,
  };
};

export const loadInPersonCustomerContext = async (input: {
  authenticatedUserId: string;
  storeId: string;
  orderId: string;
}): Promise<InPersonCustomerContext> => {
  const storeId = clean(input.storeId, 180);
  const orderId = clean(input.orderId, 220);
  const actorUserId = clean(input.authenticatedUserId, 180);
  if (!storeId || !orderId || actorUserId !== storeId) {
    throw new Error('IN_PERSON_CUSTOMER_FORBIDDEN');
  }
  const context = await resolveInPersonOrderStoreContext(storeId);
  const [legacySnapshot, canonicalSnapshot, paymentSnapshot] = await Promise.all([
    adminDb.doc(legacyOrderPath(context.legacyStoreId, orderId)).get(),
    adminDb.doc(canonicalOrderPath(context.canonicalStoreId, orderId)).get(),
    adminDb.collection(paymentCollectionPath(context.canonicalStoreId))
      .where('orderId', '==', orderId)
      .limit(MAX_PAYMENTS_PER_ORDER)
      .get(),
  ]);
  const legacyOrder = assertStaffOrder(legacySnapshot.data(), orderId);
  if (!canonicalSnapshot.exists) {
    throw new Error('IN_PERSON_CUSTOMER_CANONICAL_ORDER_NOT_FOUND');
  }
  const canonicalOrder = canonicalSnapshot.data() as DocumentData;
  const buyerId = clean(legacyOrder.buyerId, 220);
  const identityStatus =
    legacyOrder.buyerIdentityStatus === 'verified_account' &&
    buyerId &&
    !buyerId.startsWith('local-order:')
      ? 'verified_account'
      : 'unverified_local';
  const linkedCustomerId = identityStatus === 'verified_account' ? buyerId : '';
  const payments = paymentSnapshot.docs.flatMap(document => {
    const payment = parsePayment(
      document.data(),
      context.canonicalStoreId,
      orderId
    );
    return payment ? [payment] : [];
  });
  return {
    orderId,
    customerId: linkedCustomerId,
    customerName: identityStatus === 'verified_account'
      ? clean(canonicalOrder.buyerName, 160) || clean(legacyOrder.buyerName, 160)
      : clean(legacyOrder.buyerName, 160),
    identityStatus,
    payment: paymentSummary({
      order: canonicalOrder,
      payments,
      linkedCustomerId,
    }),
  };
};

export const linkInPersonOrderCustomer = async (input: {
  authenticatedUserId: string;
  value: unknown;
  now?: Date;
}): Promise<InPersonCustomerContext> => {
  const request = parseInPersonCustomerLinkInput(input.value);
  const actorUserId = clean(input.authenticatedUserId, 180);
  if (!actorUserId || actorUserId !== request.storeId) {
    throw new Error('IN_PERSON_CUSTOMER_FORBIDDEN');
  }
  const context = await resolveInPersonOrderStoreContext(request.storeId);
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('IN_PERSON_CUSTOMER_TIME_INVALID');
  const linkedAt = now.toISOString();

  const tokenReference = adminDb.doc(
    lookupTokenPath(context.canonicalStoreId, request.customerRef)
  );
  await adminDb.runTransaction(async transaction => {
    const tokenSnapshot = await transaction.get(tokenReference);
    if (!tokenSnapshot.exists) throw new Error('IN_PERSON_CUSTOMER_REF_NOT_FOUND');
    const token = tokenSnapshot.data() as DocumentData;
    const customerId = clean(token.customerId, 180);
    if (
      clean(token.storeId) !== context.canonicalStoreId ||
      clean(token.legacyStoreId) !== context.legacyStoreId ||
      clean(token.orderId) !== request.orderId ||
      clean(token.requestedByUserId) !== actorUserId ||
      token.exactPrivateMatch !== true ||
      (token.lookupKind !== 'cpf' && token.lookupKind !== 'phone') ||
      !customerId ||
      !clean(token.expiresAt) ||
      Date.parse(clean(token.expiresAt)) <= now.getTime()
    ) {
      throw new Error('IN_PERSON_CUSTOMER_REF_INVALID');
    }

    const legacyReference = adminDb.doc(
      legacyOrderPath(context.legacyStoreId, request.orderId)
    );
    const canonicalReference = adminDb.doc(
      canonicalOrderPath(context.canonicalStoreId, request.orderId)
    );
    const userReference = adminDb.doc(`users/${customerId}`);
    const identityReference = adminDb.doc(`identity_verifications/${customerId}`);
    const customerRelationshipReference = adminDb.doc(
      relationshipPath(context.canonicalStoreId, customerId)
    );
    const [legacySnapshot, canonicalSnapshot, userSnapshot, identitySnapshot, relationshipSnapshot] =
      await Promise.all([
        transaction.get(legacyReference),
        transaction.get(canonicalReference),
        transaction.get(userReference),
        transaction.get(identityReference),
        transaction.get(customerRelationshipReference),
      ]);

    const legacyOrder = assertStaffOrder(legacySnapshot.data(), request.orderId);
    if (!canonicalSnapshot.exists || !userSnapshot.exists || !identitySnapshot.exists) {
      throw new Error('IN_PERSON_CUSTOMER_LINK_TARGET_NOT_FOUND');
    }
    const identity = identitySnapshot.data() as DocumentData;
    if (identity.status !== 'approved') {
      throw new Error('IN_PERSON_CUSTOMER_IDENTITY_NOT_APPROVED');
    }
    const currentBuyerId = clean(legacyOrder.buyerId, 220);
    const alreadyVerified = legacyOrder.buyerIdentityStatus === 'verified_account';
    if (alreadyVerified && currentBuyerId !== customerId) {
      throw new Error('IN_PERSON_CUSTOMER_ALREADY_LINKED');
    }
    if (
      !alreadyVerified &&
      currentBuyerId &&
      !currentBuyerId.startsWith('local-order:')
    ) {
      throw new Error('IN_PERSON_CUSTOMER_ALREADY_LINKED');
    }

    const profile = userSnapshot.data() as DocumentData;
    const buyerName = profileDisplayName(profile, identity, customerId);
    const orderUpdate = {
      buyerId: customerId,
      buyerName,
      buyerEmail: '',
      buyerIdentityStatus: 'verified_account',
      buyerIdentityMethod: `staff_exact_${token.lookupKind}`,
      buyerIdentityLinkedAt: linkedAt,
      buyerIdentityLinkedBy: actorUserId,
      updatedAt: linkedAt,
    };
    transaction.set(legacyReference, orderUpdate, { merge: true });
    transaction.set(canonicalReference, orderUpdate, { merge: true });

    const currentRelationship = relationshipSnapshot.data() as DocumentData | undefined;
    transaction.set(customerRelationshipReference, {
      schemaVersion: 1,
      storeId: context.canonicalStoreId,
      customerId,
      status: 'active',
      source: 'in_person_identification',
      firstSeenAt: currentRelationship?.firstSeenAt ?? FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
      lastOrderId: request.orderId,
      lastLinkedByUserId: actorUserId,
      updatedAt: FieldValue.serverTimestamp(),
      ...(relationshipSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    }, { merge: true });
    transaction.delete(tokenReference);
  });

  return loadInPersonCustomerContext({
    authenticatedUserId: actorUserId,
    storeId: request.storeId,
    orderId: request.orderId,
  });
};
