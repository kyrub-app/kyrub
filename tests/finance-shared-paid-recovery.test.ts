import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  executeSharedFinanceRecovery,
  isFinanceCaptureAlreadyExists,
  FINANCE_RECOVERY_BATCH_SIZE,
  type FinanceRecoveryPort,
  type PaidFinanceSnapshot,
} from '../server/payments/storeFinanceRecoveryService';

// Fakes model Firestore's atomic create() precondition and per-store lease.
// They do not touch real payment records or customer data.
const payment = (id: string): PaidFinanceSnapshot => ({
  id,
  data: {
    schemaVersion: 1, id, storeId: 'tenant-a', buyerId: 'buyer-a',
    orderId: 'order-a', amount: 10, currency: 'BRL', context: 'marketplace',
    idempotencyKey: 'test-idempotency-'+id,
    provider: 'mercado-pago', providerPaymentId: 'provider-'+id,
    status: 'paid', method: 'pix',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T11:00:00.000Z',
    paidAt: '2026-10-01T11:00:00.000Z', refundedAt: '',
  },
});
const makePort = (input: PaidFinanceSnapshot[]) => {
  const created = new Set<string>();
  const inspections: string[] = [];
  let status: 'pending'|'running'|'complete' = 'pending';
  let cursor = '';
  let token = 0;
  let scanned = 0;
  const port: FinanceRecoveryPort = {
    acquire: async () => {
      if (status === 'complete') return {kind:'complete'};
      if (status === 'running') return {kind:'busy'};
      status='running';
      token += 1;
      return {kind:'acquired',token:String(token),cursor};
    },
    list: async (_storeId, after, size) => {
      scanned += 1;
      return input.filter(x=> x.id > after).slice(0,size);
    },
    createCapture: async (_storeId, record) => {
      if(created.has(record.id)) return false;
      created.add(record.id);
      return true;
    },
    checkpoint: async (_storeId, checkToken, next, outcome) => {
      assert.equal(checkToken,String(token));
      cursor = next;
      status = outcome;
      inspections.push(next);
    },
  };
  return {port,created,inspections,getStatus:()=>status,getScanned:()=>scanned};
};

test('capture precondition recognizes only Firestore already-exists',()=>{
 assert.equal(isFinanceCaptureAlreadyExists({code:6}),true);
 assert.equal(isFinanceCaptureAlreadyExists({code:'ALREADY_EXISTS'}),true);
 assert.equal(isFinanceCaptureAlreadyExists({code:13}),false);
 assert.equal(isFinanceCaptureAlreadyExists(new Error('unavailable')),false);
});

test('shared authority is single-flight; a concurrent GET cannot run the same scan',async()=>{
 const f=makePort([payment('a')]);
 const lease=await f.port.acquire('tenant-a');
 assert.equal(lease.kind,'acquired');
 await assert.rejects(
   executeSharedFinanceRecovery('tenant-a',f.port,async()=>{}),
   /STORE_FINANCE_RECOVERY_IN_PROGRESS/
 );
 assert.equal(f.getScanned(),0);
});

test('capture recovery remains idempotent after an existing capture and on subsequent GET',async()=>{
 const f=makePort([payment('a'),payment('b')]);
 f.created.add('a');
 const n=await executeSharedFinanceRecovery('tenant-a',f.port);
 assert.equal(n,1);
 assert.equal(f.getStatus(),'complete');
 assert.deepEqual([...f.created].sort(),['a','b']);
 assert.equal(await executeSharedFinanceRecovery('tenant-a',f.port),0);
 assert.equal(f.getScanned(),1);
});

test('all pages are traversed, not only first 100 payments',async()=>{
 const records=Array.from({length:215},(_,i)=>payment(String(i).padStart(4,'0')));
 const f=makePort(records);
 const n=await executeSharedFinanceRecovery('tenant-a',f.port);
 assert.equal(n,215);
 assert.equal(f.created.size,215);
 assert.equal(f.inspections.length,3);
 assert.equal(f.getStatus(),'complete');
 assert.equal(FINANCE_RECOVERY_BATCH_SIZE,100);
});

test('bounded run refuses incomplete financial reporting',async()=>{
 const records=Array.from({length:501},(_,i)=>payment(String(i).padStart(4,'0')));
 const f=makePort(records);
 await assert.rejects(executeSharedFinanceRecovery('tenant-a',f.port),/STORE_FINANCE_RECOVERY_CONTINUATION_REQUIRED/);
 assert.equal(f.created.size,500);
 assert.equal(f.inspections.length,5);
 assert.equal(f.getStatus(),'pending');
 // Next authorized GET resumes from the committed cursor, not from zero.
 assert.equal(await executeSharedFinanceRecovery('tenant-a',f.port),1);
 assert.equal(f.created.size,501);
 assert.equal(f.getStatus(),'complete');
});

test('recovery failure is not swallowed or mislabeled as existing capture',async()=>{
 const f=makePort([payment('a')]);
 f.port.createCapture=async()=>{throw new Error('Firestore unavailable');};
 await assert.rejects(executeSharedFinanceRecovery('tenant-a',f.port),/Firestore unavailable/);
 assert.notEqual(f.getStatus(),'complete');
});


test('concurrent finance reads wait for another worker to complete recovery',async()=>{
 const f=makePort([payment('a')]);
 // First GET already owns the transaction lease.
 const first = await f.port.acquire('tenant-a');
 assert.equal(first.kind,'acquired');
 let waits = 0;
 const observed = await executeSharedFinanceRecovery('tenant-a',f.port,async()=>{
   waits++;
   // Simulate another serverless worker completing its bounded run.
   await f.port.checkpoint('tenant-a',first.kind==='acquired' ? first.token : '', 'a', 'complete');
 });
 assert.equal(observed,0);
 assert.equal(waits,1);
 assert.equal(f.getScanned(),0);
});

test('both read endpoints delegate to ONE authenticated backend service',()=>{
 const finance=readFileSync('server/payments/storeFinanceRouter.ts','utf8');
 const history=readFileSync('server/payments/storeFinanceHistoryRouter.ts','utf8');
 const service=readFileSync('server/payments/storeFinanceRecoveryService.ts','utf8');
 for(const source of [finance,history]){
   assert.match(source,/await requireOwner\(/);
   assert.match(source,/await recoverCanonicalPaidCaptures\(storeId\)/);
   assert.doesNotMatch(source,/recoverMissingCanonicalPaidCaptures|recoverAllMissingCanonicalPaidCaptures|batch\.set\(/);
 }
 assert.match(service,/await ref\.create\(/);
 assert.match(service,/adminDb\.runTransaction/);
 assert.match(service,/transaction\.get\(ref\)/);
 assert.match(service,/transaction\.set\(ref/);
 assert.match(service,/transaction\.update\(ref/);
});
