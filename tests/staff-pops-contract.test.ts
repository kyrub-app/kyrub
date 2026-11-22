import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canReadStaffPop, safePopId, validateStaffPopAttachment,
  validateStaffPopPublication, STAFF_POP_MAX_ATTACHMENT_BYTES,
} from '../shared/staffProcedures';

test('POP publication requires bounded validated title, revision, audience and ID', () => {
  const base = {
    procedureId: 'pop_valid_identifier_12345',
    requestId: 'request_valid_identifier_12345',
    expectedVersion: 0, title: 'Higienização das bancadas',
    body: 'Limpeza diária, antes de abrir.', audienceRoles: ['production'],
  };
  assert.deepEqual(validateStaffPopPublication(base),base);
  for (const wrong of [
    {...base, title: ''}, {...base, title: 'x'.repeat(121)},
    {...base, body: 'x'.repeat(8001)},
    {...base, procedureId: '../escaped'},
    {...base, requestId: 'short'}, {...base, expectedVersion: -1},
    {...base, expectedVersion: 2.5}, {...base, audienceRoles: ['owner']},
    {...base, audienceRoles: ['seller','seller']},
  ]) assert.throws(() => validateStaffPopPublication(wrong));
  assert.equal(safePopId(base.procedureId),true);
  assert.equal(safePopId('stores/secret'),false);
});

test('private attachment is bound to canonical store, version request and checksum', () => {
  const store = 'store_canonical_private';
  const id = 'pop_valid_identifier_12345';
  const req = 'request_valid_identifier_12345';
  const sha = 'a'.repeat(64);
  const attachment = {
    path: 'staff-pops/' + store + '/' + id + '/' + req + '/' + sha,
    name: 'seguranca.pdf', mimeType: 'application/pdf', sizeBytes: 128, sha256: sha,
  };
  assert.deepEqual(validateStaffPopAttachment(attachment,store,id,req),attachment);
  assert.equal(validateStaffPopAttachment(null,store,id,req),null);
  for (const wrong of [
    {...attachment,path:'staff-pops/other/'+id+'/'+req+'/'+sha},
    {...attachment,mimeType:'text/html'},
    {...attachment,sizeBytes:STAFF_POP_MAX_ATTACHMENT_BYTES+1},
    {...attachment,sha256:'0'}, {...attachment,name:''},
  ]) assert.throws(() => validateStaffPopAttachment(wrong,store,id,req));
});

test('only assigned staff roles can read a restricted published POP', () => {
  const pop={status:'published' as const,audienceRoles:['production' as const]};
  assert.equal(canReadStaffPop('production',pop),true);
  assert.equal(canReadStaffPop('seller',pop),false);
  assert.equal(canReadStaffPop('owner',pop),true);
  assert.equal(canReadStaffPop('manager',pop),true);
  assert.equal(canReadStaffPop('seller',{...pop,audienceRoles:[]}),true);
  assert.equal(canReadStaffPop('production',{...pop,status:'draft' as never}),false);
});

test('POP API never supplies a public download URL or allows direct client Firestore/Storage writes', () => {
  const service=readFileSync('server/staff/staffProcedureService.ts','utf8');
  const transport=readFileSync('server/staff/staffProcedureTransport.ts','utf8');
  const client=readFileSync('src/utils/staffProcedures.ts','utf8');
  const rules=readFileSync('storage.rules','utf8');
  const health=readFileSync('api/health.ts','utf8');
  const vercel=readFileSync('vercel.json','utf8');
  const menu=readFileSync('src/components/store/StoreStaffCentralWorkspace.tsx','utf8');
  const editor=readFileSync('src/components/store/StoreStaffPopManager.tsx','utf8');
  const inbox=readFileSync('src/components/store/StoreStaffPopInbox.tsx','utf8');
  const point=readFileSync('src/components/LegacyRetailerPanel.tsx','utf8');
  assert.match(service,/resolveStaffActor/);
  assert.match(service,/requireManager\(actor\)/);
  assert.match(service,/ensureActorStillActive\(actor, tx\)/);
  assert.match(service,/tx\.create\(versionRef, revision\)/);
  assert.match(service,/tx\.create\(receipt,/);
  assert.match(service,/STAFF_POP_IDEMPOTENCY_CONFLICT/);
  assert.match(service,/createHash\('sha256'\)/);
  assert.match(service,/privateBucket\(\)\.file/);
  assert.match(service,/canReadStaffPop\(actor\.role, parent\)/);
  assert.match(service,/buildUserNotification/);
  assert.match(transport,/Content-Disposition/);
  assert.match(transport,/private, no-store/);
  assert.doesNotMatch(client+service,/getDownloadURL|generateSignedUrl|makePublic\(/);
  assert.doesNotMatch(client,/setDoc\(|updateDoc\(|uploadBytes\(/);
  assert.match(rules,/match \/\{allPaths=\*\*\} \{[\s\S]*allow read, write: if false/);
  assert.doesNotMatch(rules,/match \/staff-pops/);
  assert.match(health,/transport === 'staff-pops'/);
  assert.match(vercel,/transport=staff-pops/);
  assert.match(menu,/data-kyrub-staff-central="four-cards"/);
  assert.match(menu,/<StoreStaffPopManager storeId=\{storeId\}/);
  assert.match(editor,/publishStaffProcedure/);
  assert.match(inbox,/confirmStaffProcedureRead/);
  assert.match(point,/<StoreStaffPopInbox storeId=\{activeRetailerId\}/);
});
