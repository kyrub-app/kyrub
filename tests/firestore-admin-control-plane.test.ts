import express from 'express';
import { createStoreFinanceRouter } from '../server/payments/storeFinanceRouter';
import { loadInfrastructureDiagnostic } from '../server/admin/infrastructureDiagnostic';
import { financeMonthAt } from '../shared/storeFinanceCalendar';
import { readOfficialInfrastructureFixture, readOfficialRegisteredInfrastructureFixture, type InfrastructureFixtureReference } from '../server/admin/officialInfrastructureFixtureReader';
import { buildManualStoreFinancePayable } from '../shared/storeFinancePayables';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeMonthlyPresenceFixture } from '../server/observability/monthlyPresenceClosure';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyFirebaseIdToken } from '../server/ai/consultantAuth';
import { createAuthorizedKyrubActivityReceiver } from '../server/observability/kyrubActivityTransport';
import { confirmTransportMonthlyPresence } from '../server/observability/monthlyPresenceTransport';
import { loadMonthlyActivityDiagnostic } from '../server/admin/monthlyActivityDiagnostic';
import { countMonthlyPresenceMarkers } from '../server/admin/monthlyActivityDiagnostic';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { confirmMonthlyPresence, firestoreMonthlyPresenceStore, monthlyPresencePath } from '../server/observability/monthlyPresence';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'kyrub-security-test';
let environment: RulesTestEnvironment;

const adminRecord = (
  uid: string,
  role: string,
  status = 'active'
) => ({
  uid,
  email: `${uid}@example.com`,
  displayName: uid,
  role,
  status,
  createdBy: 'bootstrap_admin',
  createdAt: Timestamp.fromMillis(1_700_000_000_000),
  updatedAt: Timestamp.fromMillis(1_700_000_000_000),
  suspendedAt: status === 'suspended' ? Timestamp.fromMillis(1_700_000_000_000) : '',
  revokedAt: status === 'revoked' ? Timestamp.fromMillis(1_700_000_000_000) : '',
});

const validAudit = (actorId: string, actorRole: string) => ({
  id: 'audit_session_a',
  action: 'admin.session.accessed',
  actorId,
  actorRole,
  targetType: 'control_plane',
  targetId: 'admin_portal',
  source: 'client',
  createdAt: serverTimestamp(),
});

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('.firebase/firestore.combined.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8088,
    },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    const firestore = context.firestore();
    await Promise.all([
      setDoc(
        doc(firestore, 'kyrub_admin', 'control_plane', 'admins', 'super_admin_a'),
        adminRecord('super_admin_a', 'super_admin')
      ),
      setDoc(
        doc(firestore, 'kyrub_admin', 'control_plane', 'admins', 'support_a'),
        adminRecord('support_a', 'support')
      ),
      setDoc(
        doc(firestore, 'kyrub_admin', 'control_plane', 'admins', 'operations_a'),
        adminRecord('operations_a', 'operations')
      ),
      setDoc(
        doc(firestore, 'kyrub_admin', 'control_plane', 'admins', 'finance_a'),
        adminRecord('finance_a', 'finance')
      ),
      setDoc(
        doc(firestore, 'kyrub_admin', 'control_plane', 'admins', 'compliance_a'),
        adminRecord('compliance_a', 'compliance')
      ),
      setDoc(
        doc(firestore, 'kyrub_admin', 'control_plane', 'admins', 'suspended_a'),
        adminRecord('suspended_a', 'operations', 'suspended')
      ),
      setDoc(doc(firestore, 'users', 'user_a'), {
        uid: 'user_a',
        name: 'User A',
        email: 'user_a@example.com',
        photoUrl: '',
        isProfileVisible: true,
        createdAt: Timestamp.fromMillis(1_700_000_000_000),
        updatedAt: Timestamp.fromMillis(1_700_000_000_000),
      }),
      setDoc(doc(firestore, 'stores', 'store_admin_a'), {
        id: 'store_admin_a',
        ownerId: 'owner_a',
        name: 'Store A',
        publicationStatus: 'paused',
        plan: 'free',
        legacyTenantId: 'owner_a',
        migrationStatus: 'dual_write',
        createdAt: Timestamp.fromMillis(1_700_000_000_000),
        updatedAt: Timestamp.fromMillis(1_700_000_000_000),
      }),
    ]);
  });
});

after(async () => {
  await environment.cleanup();
});

test('a regular account cannot provision or inspect administrative identities', async () => {
  const regular = environment.authenticatedContext('regular_a').firestore();
  await assertFails(
    getDoc(doc(regular, 'kyrub_admin', 'control_plane', 'admins', 'support_a'))
  );
  await assertFails(
    setDoc(
      doc(regular, 'kyrub_admin', 'control_plane', 'admins', 'regular_a'),
      adminRecord('regular_a', 'super_admin')
    )
  );
});

test('an administrator can read its own record while only super admin can list administrators', async () => {
  const support = environment.authenticatedContext('support_a').firestore();
  await assertSucceeds(
    getDoc(doc(support, 'kyrub_admin', 'control_plane', 'admins', 'support_a'))
  );
  await assertFails(
    getDocs(collection(support, 'kyrub_admin', 'control_plane', 'admins'))
  );

  const superAdmin = environment.authenticatedContext('super_admin_a').firestore();
  await assertSucceeds(
    getDocs(collection(superAdmin, 'kyrub_admin', 'control_plane', 'admins'))
  );
});

test('an active administrator can append only a strict session audit event', async () => {
  const support = environment.authenticatedContext('support_a').firestore();
  const auditRef = doc(
    support,
    'kyrub_admin',
    'control_plane',
    'audit_logs',
    'audit_session_a'
  );

  await assertSucceeds(setDoc(auditRef, validAudit('support_a', 'support')));
  await assertFails(updateDoc(auditRef, { targetId: 'changed' }));
  await assertFails(deleteDoc(auditRef));

  await assertFails(
    setDoc(
      doc(
        support,
        'kyrub_admin',
        'control_plane',
        'audit_logs',
        'audit_arbitrary_a'
      ),
      {
        ...validAudit('support_a', 'support'),
        id: 'audit_arbitrary_a',
        action: 'admin.user.blocked',
      }
    )
  );
});

test('suspension blocks audit writes and compliance can inspect immutable events', async () => {
  const suspended = environment.authenticatedContext('suspended_a').firestore();
  await assertFails(
    setDoc(
      doc(
        suspended,
        'kyrub_admin',
        'control_plane',
        'audit_logs',
        'audit_suspended_a'
      ),
      {
        ...validAudit('suspended_a', 'operations'),
        id: 'audit_suspended_a',
      }
    )
  );

  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(
      doc(
        context.firestore(),
        'kyrub_admin',
        'control_plane',
        'audit_logs',
        'audit_existing_a'
      ),
      {
        ...validAudit('support_a', 'support'),
        id: 'audit_existing_a',
        createdAt: Timestamp.fromMillis(1_700_000_000_000),
      }
    );
  });

  const compliance = environment.authenticatedContext('compliance_a').firestore();
  await assertSucceeds(
    getDocs(collection(compliance, 'kyrub_admin', 'control_plane', 'audit_logs'))
  );

  const support = environment.authenticatedContext('support_a').firestore();
  await assertFails(
    getDocs(collection(support, 'kyrub_admin', 'control_plane', 'audit_logs'))
  );
});

test('operations can aggregate canonical stores while finance cannot enumerate them', async () => {
  const operations = environment.authenticatedContext('operations_a').firestore();
  await assertSucceeds(getDocs(collection(operations, 'stores')));

  const finance = environment.authenticatedContext('finance_a').firestore();
  await assertFails(getDocs(collection(finance, 'stores')));
});

test('monthly presence atomic create and browser isolation in the Firestore emulator', async () => {
  // Fail closed: no Admin SDK connection to a remote project is permitted here.
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8088');
  const app = initializeApp({projectId:PROJECT_ID}, 'finops-monthly-presence-fixture');
  try {
    const database = getFirestore(app);
    const secret = new Uint8Array(32).fill(42);
    const input = {authenticatedUid:'fixture-a',projectId:PROJECT_ID,qualifiedActivity:true,receivedAt:new Date('2026-11-25T12:00:00Z')};
    const store = firestoreMonthlyPresenceStore(database);
    const outcomes = await Promise.all(Array.from({length:8},()=>confirmMonthlyPresence(input,secret,store)));
    assert.equal(outcomes.filter(x=>x.status==='created').length,1);
    assert.equal(outcomes.filter(x=>x.status==='already_counted').length,7);
    const path = monthlyPresencePath(input,secret);
    const marker = await database.doc(path).get();
    assert.deepEqual(marker.data(),{schemaVersion:1,month:'2026-11'});
    const count = await database.collection('kyrub_finops_mau_months/2026-11/markers').count().get();
    assert.equal(count.data().count,1);
    assert.equal(await countMonthlyPresenceMarkers(database,'2026-11'),1);
    assert.equal(await countMonthlyPresenceMarkers(database,'2026-12'),0);
    await assert.rejects(countMonthlyPresenceMarkers(database,'2026-13'),/MAU_INVALID_MONTH/);
    for (const actor of ['regular_a','finance_a','super_admin_a']) {
      const browser = environment.authenticatedContext(actor).firestore();
      await assertFails(getDoc(doc(browser,path)));
      await assertFails(getDocs(collection(browser,'kyrub_finops_mau_months/2026-11/markers')));
      await assertFails(setDoc(doc(browser,path),{schemaVersion:1,month:'2026-11'}));
      await assertFails(deleteDoc(doc(browser,path)));
    }
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(),path)));
  } finally {
    await deleteApp(app);
  }
});

test('signed fixture authentication, activity receiver and monthly aggregate integrate on loopback Firestore', async () => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8088');
  const app = initializeApp({projectId:PROJECT_ID},'finops-signed-activity-fixture');
  const originalFetch = globalThis.fetch;
  const {privateKey,publicKey} = generateKeyPairSync('rsa',{modulusLength:2048});
  const {privateKey:foreignKey} = generateKeyPairSync('rsa',{modulusLength:2048});
  const keyId = 'finops-test-key';
  // Substitute only the public-certificate response in this test process.
  // The real verifier still verifies RSA signatures, issuer, audience and expiry.
  globalThis.fetch = async (input,init) => {
    if (String(input) === 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com') {
      return new Response(JSON.stringify({[keyId]:publicKey.export({type:'spki',format:'pem'})}),
        {status:200,headers:{'cache-control':'max-age=0','content-type':'application/json'}});
    }
    return originalFetch(input,init);
  };
  const encode = (value:unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = (uid:string, options:{foreign?:boolean;aud?:string;expired?:boolean}={}) => {
    const now = Math.floor(Date.now()/1000);
    const message = encode({alg:'RS256',kid:keyId,typ:'JWT'}) + '.' + encode({
      sub:uid, aud:options.aud ?? PROJECT_ID, iss:'https://securetoken.google.com/'+PROJECT_ID,
      iat:now-10,auth_time:now-10,exp:options.expired ? now-3600 : now+3600,email_verified:true,
    });
    return message+'.'+sign('RSA-SHA256',Buffer.from(message),options.foreign ? foreignKey : privateKey).toString('base64url');
  };
  try {
    const database = getFirestore(app);
    const env = {KYRUB_FINOPS_MAU_EMULATOR_ENABLED:'true',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8088',
      FIREBASE_PROJECT_ID:PROJECT_ID,KYRUB_FINOPS_MAU_EMULATOR_KEY:'2a'.repeat(32)};
    const deps = {env,currentProject:()=>PROJECT_ID,store:()=>firestoreMonthlyPresenceStore(database)};
    let now = new Date('2026-12-01T02:59:59Z');
    const logs:unknown[] = [];
    const receive = createAuthorizedKyrubActivityReceiver({
      verify: value=>verifyFirebaseIdToken(value,PROJECT_ID),
      now:()=>now,
      confirm:(uid,requested,qualified,at)=>confirmTransportMonthlyPresence(uid,requested,qualified,at,deps),
      log:event=>logs.push(event),
    });
    const data = {monthlyPresenceRequested:true,events:[{id:'event-1',type:'navigation.screen_viewed',
      domain:'app',source:'client_observation',authority:'context_only',screenId:'home:renda',
      actorUid:'spoofed-account',occurredAt:'2025-01-01T00:00:00Z'}]};
    const read = ()=>loadMonthlyActivityDiagnostic(now,{env,currentProject:()=>PROJECT_ID,
      count:month=>countMonthlyPresenceMarkers(database,month)});
    await assert.rejects(receive('',data),/AUTH_REQUIRED/);
    await assert.rejects(receive('Bearer '+token('a',{foreign:true}),data));
    await assert.rejects(receive('Bearer '+token('a',{aud:'wrong-project'}),data));
    await assert.rejects(receive('Bearer '+token('a',{expired:true}),data));
    assert.equal((await read()).observedMarkers,0);
    const first = 'Bearer '+token('a');
    const replies = await Promise.all(Array.from({length:8},()=>receive(first,data)));
    assert.ok(replies.every(x=>x.accepted===1 && x.monthlyPresence?.status==='confirmed' && x.monthlyPresence.month==='2026-11'));
    assert.equal((await read()).observedMarkers,1);
    assert.equal((await read()).realMau,null);
    const expected = monthlyPresencePath({authenticatedUid:'a',projectId:PROJECT_ID,qualifiedActivity:true,receivedAt:now},Buffer.from(env.KYRUB_FINOPS_MAU_EMULATOR_KEY,'hex'));
    const spoof = monthlyPresencePath({authenticatedUid:'spoofed-account',projectId:PROJECT_ID,qualifiedActivity:true,receivedAt:now},Buffer.from(env.KYRUB_FINOPS_MAU_EMULATOR_KEY,'hex'));
    assert.equal((await database.doc(expected).get()).exists,true);
    assert.equal((await database.doc(spoof).get()).exists,false);
    const second = 'Bearer '+token('b');
    assert.equal((await receive(second,{...data,events:[{...data.events[0],domain:'kyrubia'}]})).monthlyPresence?.status,'not_qualified');
    assert.equal((await read()).observedMarkers,1);
    await receive(second,data);
    assert.equal((await read()).observedMarkers,2);
    now = new Date('2026-12-01T03:00:00Z');
    await receive(first,data);
    assert.equal((await read()).observedMarkers,1);
    assert.equal(await countMonthlyPresenceMarkers(database,'2026-11'),2);
    assert.ok(logs.length>0);

    // Reuse the real signed-token verifier and the named loopback Admin app.
    // Actual ERP HTTP POST handler, without production credentials or server.
    const savedProject=process.env.FIREBASE_PROJECT_ID;
    const savedFlag=process.env.KYRUB_FINOPS_INFRASTRUCTURE_EMULATOR_ENABLED;
    process.env.FIREBASE_PROJECT_ID=PROJECT_ID;
    process.env.KYRUB_FINOPS_INFRASTRUCTURE_EMULATOR_ENABLED='true';
    const owner='owner_a', other='owner_b', canonical='store_admin_a';
    const web=express();web.use(express.json());web.use('/finance',createStoreFinanceRouter());
    const server=web.listen(0,'127.0.0.1');
    try{
      await new Promise<void>((resolve,reject)=>{if(server.listening)resolve();else{server.once('listening',resolve);server.once('error',reject);}});
      const address=server.address();
      assert.ok(address&&typeof address==='object');
      const url='http://127.0.0.1:'+address.port+'/finance';
      await database.doc('users/'+owner+'/stores/'+owner).set({id:owner,ownerId:owner,canonicalStoreId:canonical,name:'Official fixture'});
      await database.doc('users/'+other+'/stores/'+other).set({id:other,ownerId:other,name:'Other fixture'});
      await database.doc('kyrub_admin/official_store').set({schemaVersion:1,kind:'official_cairobi_store',canonicalStoreId:canonical,legacyStoreId:owner,ownerUserId:owner,designatedBy:'super_admin_a'});
      const post=async(actor:string|null,body:Record<string,unknown>)=>{
        const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json',...(actor?{authorization:'Bearer '+token(actor)}:{})},body:JSON.stringify(body)});
        return {status:response.status,body:await response.json()};
      };
      const mutation={storeId:owner,action:'mutate_taxonomy',kind:'centers',operation:'create',name:'Manutenção'};
      assert.equal((await post(null,mutation)).status,401);
      assert.equal((await post(other,mutation)).status,403);
      const duplicates=await Promise.all([post(owner,mutation),post(owner,{...mutation,name:'manutencao'})]);
      assert.deepEqual(duplicates.map(x=>x.status).sort(),[200,400]);
      const custom=duplicates.find(x=>x.status===200)!.body.id;
      const category=await post(owner,{...mutation,kind:'categories',name:'Licenças'});
      assert.equal(category.status,200);
      const customCategory=category.body.id;
      for(const operation of ['rename','remove'])assert.equal((await post(owner,{...mutation,operation,id:'cc_infrastructure'})).status,400);
      const account={storeId:owner,action:'create_payable',description:'Fixture expense',amountMinor:12000,dueDate:'2026-11-30',category:'other',recurrence:'none',costCenterId:custom,customCategoryId:customCategory};
      assert.equal((await post(other,{...account,storeId:other})).status,400);
      const created=await post(owner,account);
      assert.equal(created.status,201);
      assert.equal(created.body.payable.costCenter.name,'Manutenção');
      assert.equal(created.body.payable.customCategory.name,'Licenças');
      assert.equal((await post(owner,{...mutation,operation:'rename',id:custom,name:'Manutenção predial'})).status,200);
      assert.equal((await post(owner,{...mutation,kind:'categories',operation:'remove',id:customCategory})).status,200);
      assert.equal((await post(owner,account)).status,400);
      const old=(await database.doc('stores/'+owner+'/financePayables/'+created.body.payable.id).get()).data();
      assert.equal(old?.costCenter.name,'Manutenção');
      assert.equal(old?.customCategory.name,'Licenças');
      const infra=await post(owner,{...account,costCenterId:'cc_infrastructure',customCategoryId:'',category:'service',billingDocumentType:'invoice',billingDocumentReference:'fixture-vercel'});
      assert.equal(infra.status,201);
      const month=financeMonthAt(new Date(),'America/Sao_Paulo');
      const read=()=>loadInfrastructureDiagnostic('Bearer '+token('finance_a'),month);
      assert.equal((await read()).registeredPaidMinor,null);
      assert.equal((await post(owner,{storeId:owner,action:'mark_payable_paid',payableId:infra.body.payable.id})).status,200);
      const observed=await read();
      assert.equal(observed.registeredPaidMinor,12000);
      assert.equal(observed.matchedCount,1);
      assert.equal(observed.actualInfrastructureCostMinor,null);
      assert.equal(observed.realMau,null);
    }finally{
      await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
      if(savedProject===undefined)delete process.env.FIREBASE_PROJECT_ID;else process.env.FIREBASE_PROJECT_ID=savedProject;
      if(savedFlag===undefined)delete process.env.KYRUB_FINOPS_INFRASTRUCTURE_EMULATOR_ENABLED;else process.env.KYRUB_FINOPS_INFRASTRUCTURE_EMULATOR_ENABLED=savedFlag;
    }
  } finally {
    globalThis.fetch = originalFetch;
    await deleteApp(app);
  }
});

test('monthly fixture closure fences concurrent late writes and preserves an immutable partial summary', async () => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8088');
  const app = initializeApp({projectId:PROJECT_ID},'finops-monthly-closure-fixture');
  try {
    const database=getFirestore(app);
    const secret=new Uint8Array(32).fill(42);
    const input={authenticatedUid:'first',projectId:PROJECT_ID,qualifiedActivity:true,receivedAt:new Date('2026-11-30T23:00:00Z')};
    const store=firestoreMonthlyPresenceStore(database);
    await confirmMonthlyPresence(input,secret,store);
    await assert.rejects(closeMonthlyPresenceFixture(database,PROJECT_ID,'2026-11',new Date('2026-12-01T02:59:59Z')),/PERIOD_NOT_ENDED/);
    await assert.rejects(closeMonthlyPresenceFixture(database,'other','2026-11',new Date('2026-12-01T03:00:00Z')),/EMULATOR_ONLY/);
    const now=new Date('2026-12-01T03:00:00Z');
    const [closed,late] = await Promise.all([
      closeMonthlyPresenceFixture(database,PROJECT_ID,'2026-11',now),
      Promise.allSettled(Array.from({length:4},(_,i)=>confirmMonthlyPresence({...input,authenticatedUid:'late-'+i},secret,store))),
    ]);
    assert.equal(closed.observedMarkers,1+late.filter(x=>x.status==='fulfilled').length);
    assert.equal(closed.coverage,'partial');
    assert.equal(closed.realMau,null);
    assert.equal(await countMonthlyPresenceMarkers(database,'2026-11'),closed.observedMarkers);
    await assert.rejects(confirmMonthlyPresence({...input,authenticatedUid:'too-late'},secret,store),/MAU_MONTH_SEALED/);
    await assert.rejects(confirmMonthlyPresence(input,secret,store),/MAU_MONTH_SEALED/);
    assert.deepEqual(await closeMonthlyPresenceFixture(database,PROJECT_ID,'2026-11',new Date('2026-12-02T03:00:00Z')),closed);
    assert.equal((await confirmMonthlyPresence({...input,receivedAt:now},secret,store)).status,'created');
    const summaryPath='kyrub_finops_mau_months/2026-11/summaries/observed';
    assert.deepEqual((await database.doc(summaryPath).get()).data(),closed);
    for(const actor of ['regular_a','finance_a','super_admin_a']){
      const browser=environment.authenticatedContext(actor).firestore();
      await assertFails(getDoc(doc(browser,summaryPath)));
      await assertFails(setDoc(doc(browser,summaryPath),{observedMarkers:0}));
      await assertFails(deleteDoc(doc(browser,'kyrub_finops_mau_months/2026-11')));
    }
  } finally {await deleteApp(app);}
});

test('protected official ERP fixture reads only referenced paid accounts without writing or claiming actual costs',async()=>{
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8088');
  const app=initializeApp({projectId:PROJECT_ID},'finops-official-infrastructure-fixture');
  try {
    const db=getFirestore(app);
    const canonicalStoreId='store_admin_a', owner='owner_a',storeId=owner;
    await db.doc('kyrub_admin/official_store').set({schemaVersion:1,kind:'official_cairobi_store',canonicalStoreId,legacyStoreId:owner,ownerUserId:owner,designatedBy:'super_admin_a'});
    await db.doc('users/'+owner+'/stores/'+owner).set({id:owner,ownerId:owner,canonicalStoreId,name:'Fixture Official Store'});
    const make=(id:string,amountMinor:number,paidAt:string,ref:string)=>({...buildManualStoreFinancePayable({
      id,storeId,amountMinor,description:'Fixture invoice',category:'service',dueDate:'2026-11-30',recurrence:'monthly',
      costCenter:{id:ref==='fixture-marketing'?'cc_commercial':'cc_infrastructure',name:ref==='fixture-marketing'?'Comercial':'Infraestrutura'},
      billingDocumentType:'invoice',billingDocumentReference:ref,createdByUserId:owner,now:'2026-11-01T04:00:00.000Z'
    }),status:'paid',paidAt,updatedAt:paidAt});
    const rows=[make('payable_a',120000,'2026-12-01T02:59:59.999Z','fixture-invoice-a'),
      make('payable_b',50000,'2026-12-01T03:00:00.000Z','fixture-invoice-b'),
      make('payable_c',200000,'2026-11-20T03:00:00.000Z','fixture-marketing')];
    for(const row of rows)await db.doc('stores/'+storeId+'/financePayables/'+row.id).set(row);
    await db.doc('stores/other_store/financePayables/payable_foreign').set({...rows[0],id:'payable_foreign',storeId:'other_store'});
    await db.doc('stores/'+canonicalStoreId+'/financePayables/payable_canonical_only').set({...rows[0],id:'payable_canonical_only',storeId:canonicalStoreId,amountMinor:999999});
    await db.doc('stores/'+storeId+'/financePayables/payable_custom').set({...rows[0],id:'payable_custom',costCenter:{id:'cc_custom_fixture',name:'Infraestrutura adicional'},amountMinor:999999});
    await db.doc('stores/'+storeId+'/financePayables/payable_open').set({...rows[0],id:'payable_open',status:'open',paidAt:'',amountMinor:999999});
    const deps={db,projectId:PROJECT_ID,verify:async(token:string)=>({uid:token,emailVerified:true})};
    const reference:InfrastructureFixtureReference={payableId:'payable_a',category:'vercel',billingDocumentReference:'fixture-invoice-a',reconciliationRef:'fixture-review-a'};
    const read=(refs:InfrastructureFixtureReference[],actor='finance_a')=>readOfficialInfrastructureFixture('Bearer '+actor,'2026-11',refs,deps);
    const before=await db.doc('stores/'+storeId+'/financePayables/payable_a').get();
    const output=await read([reference]);
    assert.deepEqual(output,{month:'2026-11',timeZone:'America/Sao_Paulo',basis:'cash',scope:'emulator_only',
      status:'fixture_partial',registeredPaidMinor:120000,matchedCount:1,actualInfrastructureCostMinor:null,realMau:null});
    assert.deepEqual(await read([reference],'super_admin_a'),output);
    assert.deepEqual(await readOfficialRegisteredInfrastructureFixture('Bearer finance_a','2026-11',deps),output);
    await assert.rejects(readOfficialRegisteredInfrastructureFixture('Bearer support_a','2026-11',deps),/FORBIDDEN/);
    assert.equal((await read([{...reference,payableId:'payable_c',billingDocumentReference:'fixture-marketing'}])).status,'unavailable');
    for(const actor of ['regular_a','support_a','operations_a','suspended_a'])await assert.rejects(read([reference],actor),/FORBIDDEN/);
    await assert.rejects(readOfficialInfrastructureFixture('','2026-11',[reference],deps),/AUTH_REQUIRED/);
    await assert.rejects(readOfficialInfrastructureFixture('Bearer finance_a','2026-11',[reference],{...deps,verify:async()=>({uid:'finance_a',emailVerified:false})}),/EMAIL_NOT_VERIFIED/);
    assert.equal((await read([])).registeredPaidMinor,null);
    for(const refs of [[reference,reference],[{...reference,payableId:'payable_foreign'}],
      [{...reference,payableId:'payable_b',billingDocumentReference:'fixture-invoice-b'}],
      [{...reference,billingDocumentReference:'incorrect'}],[{...reference,payableId:'../other_store'}]])
      assert.equal((await read(refs)).status,'unavailable');
    const after=await db.doc('stores/'+storeId+'/financePayables/payable_a').get();
    assert.deepEqual(after.data(),before.data());
    assert.equal(after.updateTime?.isEqual(before.updateTime!),true);
    await db.doc('users/'+owner+'/stores/'+owner).update({canonicalStoreId:'other_store'});
    assert.equal((await readOfficialRegisteredInfrastructureFixture('Bearer finance_a','2026-11',deps)).status,'unavailable');
    await db.doc('users/'+owner+'/stores/'+owner).update({canonicalStoreId});
    await db.doc('kyrub_admin/official_store').update({ownerUserId:'other_owner',legacyStoreId:'other_owner'});
    assert.equal((await read([reference])).status,'unavailable');
  }finally{await deleteApp(app);}
});
