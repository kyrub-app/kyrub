import assert from 'node:assert/strict';
import {test} from 'node:test';
import {directoryReleaseEnabled,parsePrivateDirectoryRequest,handlePrivateDirectoryRequest} from '../server/identity/privateDirectoryServerlessTransport';
const env={KYRUB_PRIVATE_DIRECTORY_RELEASE_ENABLED:'true',VERCEL:'1',VERCEL_ENV:'production',NODE_ENV:'production'};
test('production directory requires explicit switch and production environment, without emulator or alternate credentials',()=>{
 assert.equal(directoryReleaseEnabled({}),false);
 assert.equal(directoryReleaseEnabled(env),true);
 for(const changed of [{KYRUB_PRIVATE_DIRECTORY_RELEASE_ENABLED:'false'},{VERCEL:'0'},{VERCEL_ENV:'preview'},{NODE_ENV:'test'},{FIRESTORE_EMULATOR_HOST:'127.0.0.1:8088'},{FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099'},{GOOGLE_APPLICATION_CREDENTIALS:'fixture'}]){
  assert.equal(directoryReleaseEnabled({...env,...changed}),false);
 }
});
test('directory input allowlist forbids write operations, actor spoofing and excessive queries',()=>{
 const req=(scope:string,operation:string,input:unknown)=>({scope,operation,input});
 for(const valid of [req('social','page',{}),req('social','page',{after:'user-1'}),req('social','authors',{authorIds:['user-1']}),req('social','collaborators',{term:'user@example.invalid'}),req('staff','search',{storeId:'store',term:'user@example.invalid',role:'seller'}),req('admin','identity',{term:'user-1'}),req('admin','count',{})]){
  assert.ok(parsePrivateDirectoryRequest(valid));
 }
 for(const invalid of [null,[],req('social','page',{uid:'spoof'}),req('social','authors',{authorIds:Array(41).fill('user')}),req('social','authors',{authorIds:['../private']}),req('staff','invite',{storeId:'store',term:'user@example.invalid',role:'seller',targetUid:'user'}),req('staff','search',{storeId:'store',term:'user@example.invalid',role:'owner'}),req('admin','count',{uid:'other'}),req('admin','identity',{term:' '.repeat(10)}),req('unknown','page',{}),{...req('social','page',{}),uid:'forged'}]){
  assert.equal(parsePrivateDirectoryRequest(invalid),null);
 }
});
test('unreleased handler fails closed before touching Firebase',async()=>{
 assert.equal(directoryReleaseEnabled(process.env),false);
 let code=0,body:unknown;
 const headers:Record<string,string>={};
 await handlePrivateDirectoryRequest({method:'POST',headers:{authorization:'Bearer invalid'},body:{scope:'social',operation:'page',input:{}}},{
  setHeader(name,value){headers[name]=value;},
  status(value){code=value;return {json(value){body=value;}};}
 });
 assert.equal(code,404);
 assert.deepEqual(body,{error:'DIRECTORY_DISABLED'});
 assert.match(headers['Cache-Control'],/no-store/);
});
