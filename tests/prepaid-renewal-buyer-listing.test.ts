import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const storeId = 'store-a';
const id = 'a'.repeat(64);
const root = `stores/${storeId}`;
const nextId = 'renewal-' + createHash('sha256').update(JSON.stringify([storeId,id,'123'])).digest('hex');
let buyer = 'buyer-a';
let docs = new Map<string, Record<string, unknown>>();
let rows: Array<{ id: string; data: () => Record<string, unknown> }> = [];
const proposal = { previousContractId: 'old', customerId: buyer, productId: 'product', storeId,
  months: 3, currentMonthlyPriceMinor: 10000, discountPercent: 0, totalDueMinor: 30000,
  status: 'awaiting_acceptance' };
const state = { uid: () => buyer, docs: () => docs, rows: () => rows };
(globalThis as any).__renewalListing = state;
const result = await build({ entryPoints: ['server/payments/prepaidRenewalContractListing.ts'],
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'isolated-read-only-listing', setup(b) {
    b.onResolve({ filter: /firebaseAdmin\.js$|consultantAuth\.js$|canonicalStoreIdentityService\.js$/ }, a => ({ path: a.path, namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, a => ({ contents:
      a.path.endsWith('consultantAuth.js') ? `export const authenticateConsultantRequest=async()=>({uid:globalThis.__renewalListing.uid()});` :
      a.path.endsWith('canonicalStoreIdentityService.js') ? `export const resolveCanonicalStoreIdentity=async()=>({canonicalStoreId:'store-a',ownerUserId:'owner-a'});` : `
      export const adminDb={doc:path=>({get:async()=>({exists:globalThis.__renewalListing.docs().has(path),data:()=>globalThis.__renewalListing.docs().get(path)})}),
        collection:()=>({where:()=>({limit:()=>({get:async()=>({docs:globalThis.__renewalListing.rows()})})})})};` }));
  } }],
});
const { listBuyerPrepaidRenewalProposals: list } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
let data: Record<string, unknown>;
beforeEach(() => {
  buyer = 'buyer-a'; docs = new Map();
  data = { proposal: { ...proposal }, status: 'accepted', acceptedBy: buyer, acceptedAt: new Date().toISOString() };
  rows = [{ id, data: () => data }];
});
const read = () => list({ authorization: 'test', storeId });
test('accepted proposal does not imply confirmed payment', async () => {
  assert.equal((await read()).proposals[0].renewalState, 'accepted');
});
test('filters another buyer even if the query result is malformed', async () => {
  buyer = 'another-buyer'; assert.deepEqual((await read()).proposals, []);
});
test('unknown execution remains recoverable after expiry without offering another charge', async () => {
  data.acceptedAt = '2020-01-01T00:00:00Z';
  docs.set(`${root}/prepaidRenewalPixAttempts/${id}`, { storeId, proposalId: id, status: 'reserved', executionState: 'outcome_unknown' });
  assert.equal((await read()).proposals[0].renewalState, 'recovery_required');
});
test('accepted offer without payment expires explicitly', async () => {
  data.acceptedAt = '2020-01-01T00:00:00Z'; assert.equal((await read()).proposals[0].renewalState, 'expired');
});
test('bound payment is pending until an authoritative successor exists', async () => {
  docs.set(`${root}/prepaidRenewalPixAttempts/${id}`, { storeId, proposalId: id, status: 'reserved', providerPaymentId: '123' });
  assert.equal((await read()).proposals[0].renewalState, 'awaiting_payment');
});
function activatedFixture() {
  docs.set(`${root}/prepaidRenewalSuccessors/old`, { contractId: nextId, providerPaymentId: '123' });
  docs.set(`${root}/prepaidSubscriptionContracts/${nextId}`, { contractId: nextId, previousContractId: 'old', providerPaymentId: '123',
    storeId, customerId: buyer, productId: 'product', months: 3, monthlyBasePriceMinor:10000,discountPercent:0,totalPaidMinor: 30000, acceptedAt: data.acceptedAt,
    startsAt: '2027-01-01T00:00:00Z', expiresAt: '2027-04-01T00:00:00Z' });
  docs.set(`prepaidRenewalPaymentBindings/${createHash('sha256').update('mercado_pago:123').digest('hex')}`, {
    provider: 'mercado_pago', storeId, contractId: nextId, providerPaymentId: '123', contractPath: `${root}/prepaidSubscriptionContracts/${nextId}`,
  });
}
test('listing exposes activated coverage only with contract and global payment binding', async () => {
  activatedFixture(); const row = (await read()).proposals[0];
  assert.equal(row.renewalState, 'activated'); assert.equal(row.contract.contractId, nextId);
});
test('a successor pointing to another customer never leaks its coverage', async () => {
  activatedFixture(); docs.get(`${root}/prepaidSubscriptionContracts/${nextId}`)!.customerId = 'other';
  const row = (await read()).proposals[0]; assert.equal(row.renewalState, 'recovery_required'); assert.equal(row.contract, undefined);
});
test('missing financial binding cannot be displayed as activated', async () => {
  activatedFixture(); docs.delete(`prepaidRenewalPaymentBindings/${createHash('sha256').update('mercado_pago:123').digest('hex')}`);
  assert.equal((await read()).proposals[0].renewalState, 'recovery_required');
});
