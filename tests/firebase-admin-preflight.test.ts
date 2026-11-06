import assert from 'node:assert/strict';
import { after, beforeEach, mock, test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

// Replace external SDK boundaries only. Execute the real handler and service.
// There is no real credential, network, Firestore instance or live endpoint here.
const state: any = {};
(globalThis as any).__firebasePreflightTest = state;
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
  export {default as handler} from './api/admin/operations/health';
  export {runFirebasePreflight,FIREBASE_PREFLIGHT_TIMEOUT_MS} from './server/admin/firebasePreflightService';` },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false,
  plugins: [{ name: 'isolated-preflight', setup(plugin) {
    plugin.onResolve({ filter: /^firebase-admin\/(app|auth|firestore)$/ }, args => ({path: args.path.split('/').at(-1)!, namespace: 'preflight-sdk'}));
    plugin.onLoad({filter: /.*/, namespace: 'preflight-sdk'}, args => {
      const prefix = 'const s=globalThis.__firebasePreflightTest;';
      const modules: Record<string,string> = {
        app: `export const cert=value=>{s.certificates.push(value);if(s.certError)throw s.certError;return {explicitCert:value};};
          export const initializeApp=(options,name)=>{const app={options:{...options,projectId:s.appProject},name};s.apps.push(app);return app;};
          export const deleteApp=async app=>{s.deleted.push(app);};
          export const applicationDefault=()=>{throw Error('ADC_MUST_NOT_BE_USED');};
          export const getApps=()=>{throw Error('GLOBAL_APP_MUST_NOT_BE_USED');};`,
        auth: `export const getAuth=app=>({verifyIdToken:async token=>{s.auth.push({app,token});if(s.authError)throw s.authError;return s.authPromise?await s.authPromise:s.user;}});`,
        firestore: `export const getFirestore=app=>{s.firestoreApps.push(app);return {projectId:s.dbProject,
          doc:path=>{s.paths.push(path);return {get:async()=>{s.reads++;if(s.readError)throw s.readError;return s.readPromise?await s.readPromise:{exists:s.exists,data:()=>s.profile};},
            set:()=>{s.writes++;throw Error('WRITE_FORBIDDEN');},update:()=>{s.writes++;throw Error('WRITE_FORBIDDEN');},delete:()=>{s.writes++;throw Error('WRITE_FORBIDDEN');}};},
          terminate:async()=>{s.terminated++;},
          collection:()=>{throw Error('BROAD_QUERY_FORBIDDEN');},batch:()=>{s.writes++;throw Error('WRITE_FORBIDDEN');},runTransaction:()=>{s.writes++;throw Error('WRITE_FORBIDDEN');}
        };};`,
      };
      return {contents:prefix+modules[args.path], loader:'js'};
    });
    plugin.onResolve({filter: /\.js$/}, args => {
      if (args.importer.replaceAll('\\','/').endsWith('/api/admin/operations/health.ts') &&
          args.path.startsWith('../../../server/') && !args.path.endsWith('/firebasePreflightService.js')) {
        return {path:args.path,namespace:'forbidden-admin-loader'};
      }
    });
    plugin.onLoad({filter:/.*/,namespace:'forbidden-admin-loader'},args=>({contents:
      `globalThis.__firebasePreflightTest.loaders.push(${JSON.stringify(args.path)});throw Error('AUDIT_LOADER_FORBIDDEN');`,loader:'js'}));
  }}] });
const module = {exports:{} as any};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const {handler,runFirebasePreflight,FIREBASE_PREFLIGHT_TIMEOUT_MS} = module.exports;
const envKeys=['VERCEL','VERCEL_ENV','FIREBASE_SERVICE_ACCOUNT_JSON','FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','GOOGLE_APPLICATION_CREDENTIALS'];
const savedEnv=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
const credential={project_id:'kyrub-b8d0e',client_email:'fixture@fixture.iam.gserviceaccount.com',private_key:'non-real-fixture\\nkey'};
beforeEach(()=>{
  mock.restoreAll();
  for(const key of envKeys)delete process.env[key];
  process.env.VERCEL='1';process.env.VERCEL_ENV='preview';
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON=JSON.stringify(credential);
  Object.assign(state,{certificates:[],apps:[],deleted:[],auth:[],firestoreApps:[],paths:[],loaders:[],reads:0,writes:0,terminated:0,
    appProject:'kyrub-b8d0e',dbProject:'kyrub-b8d0e',user:{uid:'admin-test',email_verified:true},
    exists:true,profile:{uid:'admin-test',status:'active',role:'super_admin'},certError:null,authError:null,readError:null,authPromise:null,readPromise:null});
});
after(()=>{mock.restoreAll();for(const key of envKeys){if(savedEnv[key]===undefined)delete process.env[key];else process.env[key]=savedEnv[key];}});
const invoke=async(method='GET',authorization='Bearer isolated-fixture')=>{
  const response:any={headers:{},httpStatus:0,body:null,setHeader(name:string,value:string){this.headers[name]=value;},
    status(code:number){this.httpStatus=code;return this;},json(value:unknown){assert.equal(this.body,null,'one response only');this.body=value;}};
  await handler({method,headers:{authorization},query:{transport:'firebase-preflight'}},response);
  assert.deepEqual(Object.keys(response.body).sort(),['code','status']);
  assert.equal(response.headers['cache-control'],'no-store');
  assert.equal(state.writes,0);assert.deepEqual(state.loaders,[]);
  return response;
};

test('GET success binds certificate, Auth and the real read boundary to the same dedicated app',async()=>{
  const r=await invoke();
  assert.equal(r.httpStatus,200);assert.deepEqual(r.body,{status:'PASS',code:null});
  assert.deepEqual(state.certificates,[{projectId:credential.project_id,clientEmail:credential.client_email,privateKey:'non-real-fixture\nkey'}]);
  assert.equal(state.apps.length,1);assert.match(state.apps[0].name,/^firebase-preflight-/);
  assert.equal(state.auth[0].app,state.apps[0]);assert.equal(state.firestoreApps[0],state.apps[0]);
  assert.deepEqual(state.paths,['kyrub_admin/control_plane/admins/admin-test']);assert.equal(state.reads,1);
  assert.deepEqual(state.deleted,[state.apps[0]]);assert.equal(state.terminated,1);
});
test('Production and Preview use the same explicit credential contract',async()=>{
  process.env.VERCEL_ENV='production';assert.equal((await invoke()).httpStatus,200);
});
test('no authentication means no SDK initialization or read',async()=>{
  const r=await invoke('GET','');assert.equal(r.httpStatus,401);assert.equal(r.body.code,'AUTH_REQUIRED');assert.equal(state.apps.length,0);assert.equal(state.reads,0);
});
test('POST cannot enter the probe or fall through to audit health',async()=>{
  const r=await invoke('POST');assert.equal(r.httpStatus,405);assert.equal(r.headers.allow,'GET');assert.equal(state.apps.length,0);
});
for(const code of ['auth/invalid-id-token','auth/id-token-expired','auth/argument-error'])
  test(`invalid authentication rejected: ${code}`,async()=>{
    state.authError=Object.assign(new Error('RAW_AUTH_DETAIL'),{code});
    const r=await invoke();assert.equal(r.httpStatus,401);assert.equal(r.body.code,'AUTH_INVALID');assert.equal(state.reads,0);
  });
test('authentication infrastructure failure is sanitized without logging',async()=>{
  const log=mock.method(console,'error',()=>{});const warn=mock.method(console,'warn',()=>{});
  state.authError=new Error('PRIVATE_KEY TOKEN RAW_ERROR');
  const r=await invoke();assert.deepEqual(r.body,{status:'FAIL',code:'ADMIN_AUTH_UNAVAILABLE'});
  assert.equal(log.mock.callCount(),0);assert.equal(warn.mock.callCount(),0);assert.equal(state.reads,0);
});
for(const role of ['operations','finance','owner','customer']) test(`non-Super-Admin role ${role} is forbidden`,async()=>{
  state.profile.role=role;state.user.role='super_admin';
  const r=await invoke();assert.equal(r.httpStatus,403);assert.equal(r.body.code,'FORBIDDEN');assert.equal(state.reads,1);
});
for(const mutation of ['inactive','missing','foreign-uid','unverified-email']) test(`reject ${mutation} profile`,async()=>{
  if(mutation==='inactive')state.profile.status='inactive';
  if(mutation==='missing')state.exists=false;
  if(mutation==='foreign-uid')state.profile.uid='other';
  if(mutation==='unverified-email')state.user.email_verified=false;
  const r=await invoke();assert.equal(r.httpStatus,403);assert.equal(r.body.code,'FORBIDDEN');
});
test('missing explicit credential does not use configured local ADC',async()=>{
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;process.env.GOOGLE_APPLICATION_CREDENTIALS='must-not-be-opened.json';
  const r=await invoke();assert.equal(r.httpStatus,503);assert.equal(r.body.code,'FIREBASE_CREDENTIAL_UNAVAILABLE');assert.equal(state.apps.length,0);
});
for(const value of ['{bad-json','null','[]','{}'])test(`invalid credential fails closed: ${value}`,async()=>{
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON=value;
  const r=await invoke();assert.equal(r.httpStatus,503);assert.equal(state.reads,0);assert.equal(state.apps.length,0);
});
test('credential project mismatch is rejected before any SDK/read',async()=>{
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON=JSON.stringify({...credential,project_id:'other'});
  const r=await invoke();assert.equal(r.body.code,'FIREBASE_PROJECT_MISMATCH');assert.equal(state.apps.length,0);
});
for(const field of ['client_email','private_key'])test(`missing credential field ${field} is rejected`,async()=>{
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON=JSON.stringify({...credential,[field]:''});
  const r=await invoke();assert.equal(r.body.code,'FIREBASE_CREDENTIAL_INVALID');assert.equal(state.apps.length,0);
});
test('SDK certificate parse failure never returns its raw error',async()=>{
  state.certError=new Error('PEM PRIVATE KEY RAW');
  const r=await invoke();assert.deepEqual(r.body,{status:'FAIL',code:'FIREBASE_CREDENTIAL_INVALID'});assert.equal(state.reads,0);
});
for(const field of ['appProject'])test(`initialized ${field} must match the validated project`,async()=>{
  state[field]='other';const r=await invoke();assert.equal(r.body.code,'FIREBASE_PROJECT_MISMATCH');assert.equal(state.reads,0);
});
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST'])test(`emulator ${key} cannot produce live PASS`,async()=>{
  process.env[key]='127.0.0.1:8088';const r=await invoke();assert.equal(r.body.code,'AUTHORIZED_RUNTIME_REQUIRED');assert.equal(state.apps.length,0);
});
test('local executor is rejected even if it has an explicit credential',async()=>{
  delete process.env.VERCEL;const r=await invoke();assert.equal(r.body.code,'AUTHORIZED_RUNTIME_REQUIRED');assert.equal(state.apps.length,0);
});
test('Firestore read failure cannot leak SDK messages, documents, tokens or credentials',async()=>{
  const log=mock.method(console,'error',()=>{});const warn=mock.method(console,'warn',()=>{});
  state.readError=new Error('credential private_key secret token contents');
  const r=await invoke();assert.equal(r.httpStatus,503);assert.deepEqual(r.body,{status:'FAIL',code:'FIREBASE_READ_FAILED'});
  assert.equal(state.reads,1);assert.equal(log.mock.callCount(),0);assert.equal(warn.mock.callCount(),0);
});
test('concurrent requests use different apps and never reuse the shared global app',async()=>{
  await Promise.all([invoke(),invoke()]);assert.equal(state.apps.length,2);
  assert.notEqual(state.apps[0].name,state.apps[1].name);assert.equal(state.reads,2);
});
test('authentication timeout is bounded and cannot start a late Firestore read',async()=>{
  mock.timers.enable({apis:['setTimeout']});
  let release!:(value:unknown)=>void;state.authPromise=new Promise(resolve=>{release=resolve;});
  const pending=runFirebasePreflight('Bearer isolated-fixture');
  mock.timers.tick(FIREBASE_PREFLIGHT_TIMEOUT_MS+1);
  const r=await pending;assert.equal(r.body.code,'PREFLIGHT_TIMEOUT');assert.equal(state.reads,0);
  release(state.user);await Promise.resolve();await Promise.resolve();
  assert.equal(state.reads,0);assert.equal(state.deleted.length,1);mock.timers.reset();
});
test('read timeout never returns a late PASS or performs a second read',async()=>{
  mock.timers.enable({apis:['setTimeout']});
  let release!:(value:unknown)=>void;state.readPromise=new Promise(resolve=>{release=resolve;});
  const pending=runFirebasePreflight('Bearer isolated-fixture');await Promise.resolve();await Promise.resolve();
  assert.equal(state.reads,1);mock.timers.tick(FIREBASE_PREFLIGHT_TIMEOUT_MS+1);
  const r=await pending;assert.equal(r.body.code,'PREFLIGHT_TIMEOUT');
  release({exists:true,data:()=>state.profile});await Promise.resolve();await Promise.resolve();
  assert.equal(state.reads,1);assert.equal(state.writes,0);mock.timers.reset();
});
test('HTTP transport returns a bounded failure even when the authentication never completes',async()=>{
  mock.timers.enable({apis:['setTimeout']});
  state.authPromise=new Promise(()=>{});
  const pending=invoke();
  for(let i=0;i<6;i++)await Promise.resolve();
  mock.timers.tick(12_001);
  const response=await pending;
  assert.equal(response.httpStatus,503);
  assert.deepEqual(response.body,{status:'FAIL',code:'PREFLIGHT_TIMEOUT'});
  assert.equal(state.reads,0);
  mock.timers.reset();
});
test('service contains no write or raw logging API and transport has a hard outer deadline',()=>{
  const service=readFileSync('server/admin/firebasePreflightService.ts','utf8');
  assert.doesNotMatch(service,/\.(?:set|update|delete|add|batch|runTransaction)\s*\(/);
  assert.doesNotMatch(service,/console\.|applicationDefault|getApps\(/);
  const route=readFileSync('api/admin/operations/health.ts','utf8');
  const start=route.indexOf("transport === 'firebase-preflight'");
  assert.ok(start>0);assert.ok(start<route.indexOf("transport === 'integration-readiness'"));
  assert.match(route.slice(start,route.indexOf("transport === 'social-moderation-list'")),/12_000/);
});
test('real SDK module imports without starting the endpoint or using any credential',async()=>{
  await import('../server/admin/firebasePreflightService');
});
