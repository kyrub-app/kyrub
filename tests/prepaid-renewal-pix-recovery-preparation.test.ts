import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';

const storeId = 'canonical-store';
const proposalId = 'b'.repeat(64);
const acceptedAt = new Date(Date.now() - 60 * 60_000).toISOString();
const expiresAt = new Date(Date.parse(acceptedAt) + 30 * 60_000).toISOString();
const proposal = { storeId, customerId: 'buyer', previousContractId: 'old', productId: 'product', totalDueMinor: 12000 };
const acceptance = { customerId: 'buyer', storeId, acceptedTotalMinor: 12000, acceptedAt };
const body = JSON.stringify({ transaction_amount: 120, payment_method_id: 'pix', payer: { email: 'original@example.test' }, date_of_expiration: expiresAt,
  external_reference: `kyrub:prepaid-renewal:${storeId}:${proposalId}`, metadata: { kyrub_store_id: storeId, kyrub_prepaid_renewal_proposal_id: proposalId } });
let attempt: Record<string, unknown>;
let saved: Record<string, unknown>;
(globalThis as any).__renewalPreparation = {
  doc: (path: string) => ({ get: async () => {
    const predecessor = { storeId, contractId: 'old', customerId: 'buyer', productId: 'product', subscriptionId: 'canonical-subscription' };
    const subscription = { id: 'canonical-subscription', storeId, buyerId: 'buyer', productId: 'product' };
    const value = path.includes('PixAttempts') ? attempt
      : path.includes('prepaidSubscriptionContracts') ? predecessor
      : path.includes('/subscriptions/') ? subscription : saved;
    return { exists: true, data: () => value, get: (field: string) => (value as Record<string, unknown>)[field] };
  } }),
  auth: async () => ({ uid: 'buyer', email: 'changed@example.test' }),
  accepted: async () => ({ proposal, acceptance }),
  authority: async () => ({ context: 'store_subscription', recipientKind: 'merchant_store', credentialAuthority: 'store_oauth_vault', canonicalStoreId: storeId, ownerUserId: 'owner', credentialScopeId: 'owner', externalAccountId: '42' }),
};
const bundle = await build({ entryPoints: ['server/payments/prepaidRenewalCheckoutPreparation.ts'], write: false, bundle: true, platform: 'node', format: 'esm', plugins: [{ name: 'isolated', setup(p) {
  const sources: Record<string, string> = {
    'firebaseAdmin.js': 'export const adminDb=globalThis.__renewalPreparation',
    'consultantAuth.js': 'export const authenticateConsultantRequest=globalThis.__renewalPreparation.auth',
    'prepaidRenewalActivation.js': 'export const loadAcceptedPrepaidRenewal=globalThis.__renewalPreparation.accepted',
    'commercialRecipientAuthorityService.js': 'export const resolveCommercialRecipientAuthority=globalThis.__renewalPreparation.authority',
  };
  p.onResolve({ filter: /^\.\.?\// }, args => sources[args.path.split('/').at(-1)!] ? { path: args.path.split('/').at(-1)!, namespace: 'isolated' } : undefined);
  p.onLoad({ filter: /.*/, namespace: 'isolated' }, args => ({ contents: sources[args.path] }));
} }] });
const { prepareAuthenticatedPrepaidRenewalPixWithRecipient: prepare } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
beforeEach(() => {
  saved = { status: 'accepted', acceptedBy: 'buyer', sellerCredentialScopeId: storeId,
    proposal, acceptance, paymentExternalReference: `kyrub:prepaid-renewal:${storeId}:${proposalId}` };
  attempt = { storeId, proposalId, status: 'reserved', idempotencyKey: `prepaid-renewal-${proposalId}`, requestBody: body,
    requestDigest: createHash('sha256').update(body).digest('hex'), expiresAt };
});
const input = { authorization: 'Bearer test', storeId, proposalId };
test('GET-only recovery preserves exact expired body and original payer after email change', async () => {
  const result = await prepare({ ...input, readOnlyRecovery: true });
  assert.equal(result.request.init.body, body); assert.equal(result.recipient.credentialScopeId, 'owner');
  assert(Date.parse(expiresAt) < Date.now());
});
test('the same expired proposal cannot prepare a new payment creation', async () => {
  await assert.rejects(prepare(input), /RENEWAL_PIX_ACCEPTANCE_WINDOW_EXPIRED/);
});
test('recovery rejects changed persisted request even when it has a self-consistent digest', async () => {
  for (const change of [{ transaction_amount: 1 }, { external_reference: 'other' }, { date_of_expiration: new Date(Date.now() + 3600_000).toISOString() }]) {
    attempt.requestBody = JSON.stringify({ ...JSON.parse(body), ...change });
    attempt.requestDigest = createHash('sha256').update(attempt.requestBody as string).digest('hex');
    await assert.rejects(prepare({ ...input, readOnlyRecovery: true }), /RECOVERY_CONFLICT/);
  }
});
test('legacy expired attempts without retained request fail closed', async () => {
  delete attempt.requestBody;
  await assert.rejects(prepare({ ...input, readOnlyRecovery: true }), /ACCEPTANCE_WINDOW_EXPIRED/);
});
test('malformed or digest-corrupted retained requests fail closed', async () => {
  for (const value of ['null', '[]', 'invalid', '{}']) {
    attempt.requestBody = value;
    await assert.rejects(prepare({ ...input, readOnlyRecovery: true }), /RECOVERY_CONFLICT/);
  }
});
