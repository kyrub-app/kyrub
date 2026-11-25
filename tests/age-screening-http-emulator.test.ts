import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import { adminAuth, adminDb } from '../server/firebaseAdmin.js';
import { createAgeScreeningRouter, ageScreeningEmulatorsReady } from '../server/identity/ageScreeningRouter.js';

test('verified emulator session screens once and keeps the private record minimal', async () => {
  assert.ok(ageScreeningEmulatorsReady(process.env));
  const app = express();
  app.use('/age', createAgeScreeningRouter());
  const {createIngressLegalPreviewRouter}=await import('../server/governance/ingressLegalPreviewRouter.js');
  app.use('/legal',createIngressLegalPreviewRouter());
  const server = app.listen(0, '127.0.0.1');
  await once(server,'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const url = 'http://127.0.0.1:' + address.port + '/age';
    const endpoint = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator';
    const email = 'age-' + Date.now() + '@example.invalid';
    const password = 'Only-use-in-emulators1';
    const user = await adminAuth.createUser({ email,password });
    const signIn = async () => {
      const result = await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
      assert.equal(result.status,200);
      return (await result.json()).idToken as string;
    };
    const read = (token:string) => fetch(url,{headers:{Authorization:'Bearer '+token}});
    const write = (token:string,body:unknown) => fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await read(await signIn())).status,401);
    await adminAuth.updateUser(user.uid,{emailVerified:true});
    const token = await signIn();
    const initial = await read(token);
    assert.equal(initial.headers.get('cache-control'),'no-store');
    assert.deepEqual(await initial.json(),{status:'pending'});
    const valid = {birthDate:'2000-01-01',declaredAdult:true};
    assert.equal((await write(token,{...valid,uid:'other'})).status,400);
    const responses = await Promise.all([write(token,valid),write(token,valid)]);
    for (const response of responses) assert.deepEqual(await response.json(),{status:'declared_adult'});
    assert.deepEqual(await (await write(token,{birthDate:'2020-01-01',declaredAdult:false})).json(),{status:'declared_adult'});
    const stored = await adminDb.doc('age_eligibility_private/'+user.uid).get();
    assert.deepEqual(Object.keys(stored.data()!).sort(),['uid','method','recordedAt','policyVersion','status'].sort());
    // Prototype is available only inside this isolated test and never mounts legacy APIs.
    const {privatePersonalWorkspace}=await import('../server/identity/privatePersonalWorkspace.js');
    const {requireKyrubSessionMfa}=await import('../server/identity/kyrubMfaAuthorization.js');
    const authHeader='Bearer '+token;
    await assert.rejects(requireKyrubSessionMfa(authHeader,'financial',300),/second_factor_required/);
    await requireKyrubSessionMfa(authHeader,'ordinary',300);
    await assert.rejects(privatePersonalWorkspace(authHeader,'notes'),/PERSONAL_UNAVAILABLE/);
    process.env.KYRUB_PERSONAL_PREVIEW_ENABLED='true';
    try{
      await assert.rejects(privatePersonalWorkspace(authHeader,'notes'),/PERSONAL_FORBIDDEN/);
      await adminDb.doc('age_eligibility_private/'+user.uid).update({status:'inconclusive'});
      const note=await privatePersonalWorkspace(authHeader,'notes',{action:'create',text:'Nota privada de teste'});
      const task=await privatePersonalWorkspace(authHeader,'tasks',{action:'create',text:'Tarefa privada de teste'});
      assert.equal(note.items.length,1);assert.equal(task.items.length,1);
      await assert.rejects(privatePersonalWorkspace(authHeader,'notes',{action:'create',text:'Compartilhar',sharedWith:['other']}),/PERSONAL_INVALID/);
      const second=await adminAuth.createUser({email:'second-'+email,password,emailVerified:true});
      await adminDb.doc('age_eligibility_private/'+second.uid).set({uid:second.uid,status:'inconclusive'});
      const secondLogin=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:second.email,password,returnSecureToken:true})});
      assert.equal(secondLogin.status,200);
      const secondHeader='Bearer '+(await secondLogin.json()).idToken;
      assert.deepEqual(await privatePersonalWorkspace(secondHeader,'notes'),{items:[]});
      await assert.rejects(privatePersonalWorkspace(secondHeader,'notes',{action:'delete',id:note.items[0].id}),/PERSONAL_INVALID/);
      assert.equal((await privatePersonalWorkspace(authHeader,'tasks',{action:'update',id:task.items[0].id,text:'Concluída',done:true})).items[0].done,true);
      assert.equal((await privatePersonalWorkspace(authHeader,'notes',{action:'delete',id:note.items[0].id})).items.length,0);
      await adminDb.doc('age_eligibility_private/'+user.uid).update({status:'suspended'});
      await assert.rejects(privatePersonalWorkspace(authHeader,'tasks'),/PERSONAL_FORBIDDEN/);
    }finally{delete process.env.KYRUB_PERSONAL_PREVIEW_ENABLED;}
    // Synthetic legal publications exercise transaction semantics, not legal approval.
    const {recordIngressLegalReceipt,requireCurrentIngressLegalReceiptInTransaction}=await import('../server/governance/ingressLegalReceiptService.js');
    const {createHash}=await import('node:crypto');
    const content='Documento sintético para homologação';
    const hash=createHash('sha256').update(content).digest('hex');
    const decision={terms:{id:'terms-test',version:'1',hash,accepted:true},privacy:{id:'privacy-test',version:'1',hash,acknowledged:true}};
    await assert.rejects(recordIngressLegalReceipt(authHeader,decision),/LEGAL_RECEIPT_UNAVAILABLE/);
    const legalUrl='http://127.0.0.1:'+address.port+'/legal';
    const readLegal=()=>fetch(legalUrl,{headers:{Authorization:authHeader}});
    const writeLegal=(body:unknown)=>fetch(legalUrl,{method:'POST',headers:{Authorization:authHeader,'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await readLegal()).status,404);
    process.env.KYRUB_LEGAL_RECEIPT_PREVIEW_ENABLED='true';
    try{
      await assert.rejects(recordIngressLegalReceipt(authHeader,decision),/LEGAL_DOCUMENTS_UNAVAILABLE/);
      for(const [id,type] of [['terms-test','terms'],['privacy-test','privacy']]){
        await adminDb.doc('governanceDocuments/'+id).set({id,type,version:'1',hash,content,status:'published',ownerUserId:'test-legal',createdAt:'2026-01-01T00:00:00Z',approvedAt:'2026-01-02T00:00:00Z',publishedAt:'2026-01-03T00:00:00Z'});
      }
      assert.equal((await fetch(legalUrl)).status,401);
      const legal=await readLegal();
      assert.equal(legal.status,200);
      assert.equal(legal.headers.get('cache-control'),'no-store');
      const shown=await legal.json();
      assert.equal(shown.accepted,false);assert.equal(shown.terms.content,content);assert.equal(shown.privacy.hash,hash);
      assert.equal((await writeLegal({...decision,uid:'other'})).status,400);
      await assert.rejects(recordIngressLegalReceipt(authHeader,{...decision,uid:'other'}),/LEGAL_DECISION_INVALID/);
      await assert.rejects(recordIngressLegalReceipt(authHeader,{...decision,privacy:{...decision.privacy,acknowledged:false}}),/LEGAL_DECISION_INVALID/);
      const requireReceipt=(uid:string)=>adminDb.runTransaction(tx=>requireCurrentIngressLegalReceiptInTransaction(tx,uid));
      await assert.rejects(requireReceipt(user.uid),/LEGAL_CURRENT_RECEIPT_REQUIRED/);
      const receipts=await Promise.all([recordIngressLegalReceipt(authHeader,decision),recordIngressLegalReceipt(authHeader,decision)]);
      assert.equal(receipts[0].receiptId,receipts[1].receiptId);
      assert.equal(receipts.filter(r=>!r.replay).length,1);
      const record=await adminDb.doc('ingress_legal_receipts_private/'+receipts[0].receiptId).get();
      assert.equal(record.get('uid'),user.uid);
      assert.equal(record.get('terms.accepted'),true);
      assert.equal(record.get('privacy.acknowledged'),true);
      assert.ok(record.get('recordedAt'));
      assert.equal(await requireReceipt(user.uid),receipts[0].receiptId);
      assert.equal((await (await readLegal()).json()).accepted,true);
      assert.deepEqual(await (await writeLegal(decision)).json(),{receiptId:receipts[0].receiptId,replay:true});
      await assert.rejects(requireReceipt('unrelated-user'),/LEGAL_CURRENT_RECEIPT_REQUIRED/);
      // Explicit promotion of a synthetic minimal identity, in emulators only.
      const {promoteTagIdentityToKyrub}=await import('../server/identity/kyrubTagMinimalIdentityService.js');
      const marker=adminDb.doc('kyrub_tag_minimal_identities/'+user.uid);
      await marker.set({uid:user.uid,mode:'tag_only',source:'kyrub_tag_promo'});
      await adminDb.doc('age_eligibility_private/'+user.uid).update({status:'verified_adult'});
      assert.notEqual(process.env.KYRUB_TAG_FULL_ACCOUNT_RELEASE_ENABLED,'true');
      await assert.rejects(promoteTagIdentityToKyrub(user.uid),/TAG_PROMOTION_AGE_REQUIRED/);
      process.env.KYRUB_TAG_FULL_ACCOUNT_RELEASE_ENABLED='true';
      try{
        const outcomes=await Promise.all([promoteTagIdentityToKyrub(user.uid),promoteTagIdentityToKyrub(user.uid)]);
        assert.equal(outcomes.filter(r=>!r.replay).length,1);
        assert.equal(outcomes.every(r=>r.mode==='full'),true);
        const promoted=await marker.get();
        assert.equal(promoted.get('ingressReceiptId'),receipts[0].receiptId);
        const firstPromotion=promoted.get('promotedAt').toMillis();
        assert.ok(firstPromotion);
        assert.equal((await adminDb.doc('users/'+user.uid).get()).exists,false);
        await adminDb.doc('governanceDocuments/terms-test').update({version:'2'});
        await assert.rejects(promoteTagIdentityToKyrub(user.uid),/LEGAL_CURRENT_RECEIPT_REQUIRED/);
        assert.equal((await marker.get()).get('promotedAt').toMillis(),firstPromotion);
        await adminDb.doc('age_eligibility_private/'+user.uid).update({status:'suspended'});
        await assert.rejects(promoteTagIdentityToKyrub(user.uid),/TAG_PROMOTION_AGE_REQUIRED/);
      }finally{delete process.env.KYRUB_TAG_FULL_ACCOUNT_RELEASE_ENABLED;}

      await assert.rejects(requireReceipt(user.uid),/LEGAL_CURRENT_RECEIPT_REQUIRED/);
      const revised=await (await readLegal()).json();
      assert.equal(revised.accepted,false);assert.equal(revised.terms.version,'2');
      assert.equal((await writeLegal(decision)).status,409);
      await assert.rejects(recordIngressLegalReceipt(authHeader,decision),/LEGAL_VERSION_CHANGED/);
      await adminDb.doc('governanceDocuments/terms-test').update({content:'modified'});
      await assert.rejects(recordIngressLegalReceipt(authHeader,decision),/LEGAL_DOCUMENTS_UNAVAILABLE/);
      assert.equal((await adminDb.collection('ingress_legal_receipts_private').get()).size,1);
      assert.equal((await adminDb.doc('users/'+user.uid).get()).exists,false);
    }finally{delete process.env.KYRUB_LEGAL_RECEIPT_PREVIEW_ENABLED;}
    await adminAuth.updateUser(user.uid,{disabled:true});
    assert.equal((await read(token)).status,401);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve())); }
});
