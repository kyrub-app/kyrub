import assert from 'node:assert/strict';
import { createSign,generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import express from 'express';
import handler from '../api/health.ts';
import {adminDb} from '../server/firebaseAdmin.ts';

const projectId='kyrub-security-test';
assert.match(process.env.FIRESTORE_EMULATOR_HOST??'',/^(127\.0\.0\.1|localhost):\d+$/);
assert.equal(process.env.FIREBASE_PROJECT_ID,projectId);
assert.notEqual(process.env.VERCEL_ENV,'production');
const owner='store_media_owner_test';
const canonical='store_media_canonical_test';
const manager='store_media_manager_test';
const seller='store_media_seller_test';
const outsider='store_media_outsider_test';
const suspended='store_media_suspended_test';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{
  modulusLength:2048,
  privateKeyEncoding:{type:'pkcs8',format:'pem'},
  publicKeyEncoding:{type:'spki',format:'pem'},
});
const kid='store-media-isolated';
const certUrl='https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const originalFetch=globalThis.fetch;
globalThis.fetch=(resource,opts)=>{
  const url=resource instanceof URL?resource.href:typeof resource==='string'?resource:resource.url;
  if(url===certUrl)return Promise.resolve(new Response(JSON.stringify({[kid]:publicKey}),{
    status:200,headers:{'cache-control':'max-age=60','content-type':'application/json'},
  }));
  if(url.startsWith('https://'))throw Error('EXTERNAL_HTTP_BLOCKED');
  return originalFetch(resource,opts);
};
const now=Math.floor(Date.now()/1000);
const signed=uid=>{
  const head=Buffer.from(JSON.stringify({alg:'RS256',kid,typ:'JWT'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({
    aud:projectId,iss:'https://securetoken.google.com/'+projectId,
    sub:uid,iat:now,exp:now+3600,auth_time:now,
  })).toString('base64url');
  const raw=head+'.'+payload;
  return raw+'.'+createSign('RSA-SHA256').update(raw).sign(privateKey,'base64url');
};
const tokens=Object.fromEntries([owner,manager,seller,suspended,outsider].map(id=>[id,signed(id)]));
const app=express();
app.use(express.json({limit:'32kb'}));
app.all('/api/health',async(req,res)=>{await handler(req,res);});
const server=app.listen(0,'127.0.0.1');
await once(server,'listening');
const origin='http://127.0.0.1:'+server.address().port;
const request=async({uid,method='GET',body,storeId=owner})=>{
  const query=new URLSearchParams({transport:'store-media',storeId});
  const response=await originalFetch(origin+'/api/health?'+query.toString(),{
    method,
    headers:{...(uid?{authorization:'Bearer '+tokens[uid]}:{}),
      ...(body?{'content-type':'application/json'}:{})},
    ...(body?{body:JSON.stringify({storeId,...body})}:{}),
  });
  return {status:response.status,data:await response.json()};
};
const photo=n=>'https://example.com/gallery-'+n+'.jpg';
const member=(uid,role,status='active')=>({
  storeId:canonical,userId:uid,role,status,
  invitedBy:owner,acceptedAt:new Date().toISOString(),
});
try{
  await Promise.all([
    adminDb.doc('tenants/'+owner).set({id:owner,ownerId:owner,canonicalStoreId:canonical}),
    adminDb.doc('stores/'+canonical).set({id:canonical,ownerId:owner}),
    adminDb.doc('stores/'+canonical+'/members/'+manager).set(member(manager,'manager')),
    adminDb.doc('stores/'+canonical+'/members/'+seller).set(member(seller,'seller')),
    adminDb.doc('stores/'+canonical+'/members/'+suspended).set(member(suspended,'manager','suspended')),
    adminDb.doc('users/'+owner+'/stores/'+owner).set({
      id:owner,ownerId:owner,logo:'',banner:photo(1),
    }),
    adminDb.doc('marketplace_listings/s_'+owner.length+'_'+owner).set({
      listingId:'s_'+owner.length+'_'+owner,listingType:'store',
      storeId:owner,ownerId:owner,logo:'',banner:photo(1),
      slug:'store-media-test',publicationStatus:'published',
      publishedAt:'immutable-publication-evidence',
    }),
  ]);
  const initial=await request({uid:manager});
  assert.equal(initial.status,200,JSON.stringify(initial));
  assert.deepEqual(initial.data.bannerImages,[photo(1)]);
  assert.deepEqual(initial.data.galleryImages,[]);
  assert.equal(initial.data.version,0);

  assert.equal((await request({})).status,401);
  assert.equal((await request({uid:seller})).status,403);
  assert.equal((await request({uid:outsider})).status,403);
  assert.equal((await request({uid:suspended})).status,403);

  const media={
    logo:photo(7),bannerImages:[photo(1),photo(2),photo(3),photo(4),photo(5)],
    galleryImages:[photo(6),photo(8)],expectedVersion:0,
  };
  const denied=await request({uid:seller,method:'POST',body:media});
  assert.equal(denied.status,403);
  const cross=await request({uid:manager,method:'POST',body:media,storeId:'another_owner'});
  assert.equal(cross.status,404);
  const excessive=await request({uid:manager,method:'POST',body:{
    ...media,bannerImages:[...media.bannerImages,photo(9)]}});
  assert.equal(excessive.status,400);
  const unsafe=await request({uid:manager,method:'POST',body:{...media,galleryImages:['javascript:alert(1)']}});
  assert.equal(unsafe.status,400);

  const saved=await request({uid:manager,method:'POST',body:media});
  assert.equal(saved.status,200,JSON.stringify(saved));
  assert.equal(saved.data.version,1);
  assert.deepEqual(saved.data.bannerImages,media.bannerImages);
  assert.deepEqual(saved.data.galleryImages,media.galleryImages);
  const repeat=await request({uid:manager,method:'POST',body:{...media,expectedVersion:1}});
  assert.equal(repeat.status,200);
  assert.equal(repeat.data.version,1);
  assert.equal((await request({uid:owner,method:'POST',body:media})).status,409);
  const primary=await adminDb.doc('users/'+owner+'/stores/'+owner).get();
  const listing=await adminDb.doc('marketplace_listings/s_'+owner.length+'_'+owner).get();
  assert.deepEqual(primary.get('galleryImages'),media.galleryImages);
  assert.deepEqual(listing.get('bannerImages'),media.bannerImages);
  assert.equal(listing.get('publishedAt'),'immutable-publication-evidence');
  assert.equal(listing.get('publicationStatus'),'published');
  assert.equal((await adminDb.collection('stores/'+canonical+'/payments').get()).size,0);
  assert.equal((await adminDb.collection('stores/'+canonical+'/reservations').get()).size,0);
  console.log('STORE_MEDIA_MANAGER_E2E_PASS');
}finally{
  globalThis.fetch=originalFetch;
  await new Promise(resolve=>server.close(resolve));
}
