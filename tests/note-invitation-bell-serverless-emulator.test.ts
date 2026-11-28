import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

test('note invitation bell: authenticated serverless transport, isolation and replay', async () => {
  const project='kyrub-security-test';
  for(const key of ['FIREBASE_PROJECT_ID','GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT'])assert.equal(process.env[key],project);
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8088');
  assert.equal(process.env.NODE_ENV,'test');
  for(const key of ['VERCEL','VERCEL_ENV','FIREBASE_SERVICE_ACCOUNT_JSON','GOOGLE_APPLICATION_CREDENTIALS'])assert.ok(!process.env[key],key);
  assert.equal(getApps().length,0);
  const app=initializeApp({projectId:project}),db=getFirestore(app);
  const suffix=randomUUID().slice(0,8),owner='owner-'+suffix,recipient='recipient-'+suffix,stranger='stranger-'+suffix,note='note-'+suffix;
  const id=owner+'__'+note+'__'+recipient;
  const task=db.doc('users/'+owner+'/tasks/'+note),invite=db.doc('note_invitations/'+id);
  const keys=generateKeyPairSync('rsa',{modulusLength:2048});
  const pub=keys.publicKey.export({type:'spki',format:'pem'}).toString();
  const encode=(x:object)=>Buffer.from(JSON.stringify(x)).toString('base64url');
  const token=(uid:string,aud=project)=>{
    const now=Math.floor(Date.now()/1000);
    const unsigned=encode({alg:'RS256',kid:'isolated-note-test'})+'.'+encode({aud,iss:'https://securetoken.google.com/'+aud,sub:uid,iat:now,auth_time:now,exp:now+3600});
    return unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),keys.privateKey).toString('base64url');
  };
  // Fixture signing key only; production verifier and claims checks remain intact.
  // Do not call Google certificate service or accept unsigned Auth Emulator tokens.
  const realFetch=globalThis.fetch;
  globalThis.fetch=async (input,init)=>{
    if(String(input)==='https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com')
      return new Response(JSON.stringify({'isolated-note-test':pub}),{headers:{'cache-control':'max-age=60','content-type':'application/json'}});
    return realFetch(input,init);
  };
  const {handleUserNotificationsServerlessRequest}=await import('../server/notifications/userNotificationsServerlessTransport.js');
  const server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url??'/','http://127.0.0.1');
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      Object.assign(req,{query:Object.fromEntries(url.searchParams),body:chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined});
      await handleUserNotificationsServerlessRequest(req,res);
    }catch{if(!res.headersSent)res.writeHead(500);res.end();}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const endpoint='http://127.0.0.1:'+address.port+'/api/health?transport=user-notifications';
  const request=async(path:string,auth?:string,body?:object)=>{
    const result=await realFetch(endpoint+(path?'&path='+encodeURIComponent(path):''),{method:body?'POST':'GET',headers:{...(auth?{authorization:'Bearer '+auth}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    assert.match(result.headers.get('cache-control')??'',/no-store/);
    return {status:result.status,body:result.status===204?null:await result.json()};
  };
  const issue=(auth?:string,invitationId=id)=>request('note-invitations/received',auth,{invitationId});
  const inbox=(uid:string)=>request('',token(uid));
  try{
    await task.set({ownerId:owner,sharedWith:[recipient],title:'private-fixture'});
    await invite.set({ownerId:owner,recipientId:recipient,noteId:note,sourcePath:task.path,status:'pending'});
    assert.equal((await issue()).status,401);
    assert.equal((await issue(token(owner,'wrong-project'))).status,401);
    assert.equal((await issue(token(stranger))).status,403);
    assert.equal((await issue(token(recipient))).status,403);
    assert.equal((await issue(token(owner),'bad/id')).status,400);
    await task.update({sharedWith:[]});
    assert.equal((await issue(token(owner))).status,403);
    assert.equal((await inbox(recipient)).body.unreadCount,0);
    await task.update({sharedWith:[recipient]});
    const results=await Promise.all(Array.from({length:3},()=>issue(token(owner))));
    assert.ok(results.every(x=>x.status===200));
    assert.equal(results.filter(x=>x.body.created===true).length,1);
    const received=await inbox(recipient);
    assert.equal(received.status,200);assert.equal(received.body.unreadCount,1);
    assert.equal(received.body.notifications.length,1);
    const n=received.body.notifications[0];
    assert.equal(n.target.noteInvitationId,id);assert.equal(n.target.kind,'note_invitation');
    assert.equal(n.recipientUserId,recipient);assert.equal(n.actorPrincipalId,owner);
    assert.ok(!JSON.stringify(n).includes('private-fixture'));
    for(const uid of [owner,stranger])assert.deepEqual((await inbox(uid)).body,{notifications:[],unreadCount:0});
    assert.equal((await request('read',token(stranger),{notificationId:n.id})).status,404);
    assert.equal((await request('read',token(recipient),{notificationId:n.id})).status,204);
    assert.equal((await inbox(recipient)).body.unreadCount,0);
    assert.deepEqual(await issue(token(owner)),{status:200,body:{created:false}});
    await invite.update({status:'revoked'});
    assert.equal((await issue(token(owner))).status,403);
    await invite.update({status:'pending'});
    assert.deepEqual(await issue(token(owner)),{status:200,body:{created:false}});
    assert.equal((await inbox(recipient)).body.notifications.length,1);
    assert.equal((await inbox(recipient)).body.unreadCount,0);
  }finally{
    globalThis.fetch=realFetch;
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    const batch=db.batch();batch.delete(task);batch.delete(invite);
    for(const uid of [owner,recipient,stranger])for(const d of (await db.collection('users/'+uid+'/notifications').get()).docs)batch.delete(d.ref);
    await batch.commit();await db.terminate();
  }
});
