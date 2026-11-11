/** Non-visual compatibility check for the existing disposable QA host. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '') ||
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  throw new Error('QA_REQUIRES_LOCAL_EMULATORS_WITHOUT_CREDENTIALS');
}
process.env.KYRUB_VISUAL_QA = '1';
process.env.FIREBASE_PROJECT_ID = 'demo-kyrub-control-plane';
const host = spawn(process.execPath, ['--import','tsx','scripts/qa/globalChallengeVisualServer.ts'], { cwd: process.cwd(), env:process.env, stdio:['ignore','pipe','pipe'] });
try {
  await new Promise<void>((resolve,reject) => {
    let output='';
    const timeout=setTimeout(()=>reject(Error('QA_HOST_START_TIMEOUT')),45000);
    host.stdout.on('data',chunk=>{output+=chunk;if(output.includes('"ready":true')){clearTimeout(timeout);resolve();}});
    host.on('exit',code=>{clearTimeout(timeout);reject(Error('QA_HOST_EXIT_'+code));});
  });
  const sessionResponse=await fetch('http://127.0.0.1:3000/qa/session?run=review-smoke&case=normal');
  assert.equal(sessionResponse.status,200);
  const session=await sessionResponse.json();
  const headers={authorization:'Bearer '+session.token};
  const list=await fetch('http://127.0.0.1:3000/api/admin/global-challenges?operation=list',{headers});
  assert.equal(list.status,200); assert.equal((await list.json()).items.length,20);
  const {adminAuth}=await import('../../server/firebaseAdmin.js');
  await adminAuth.updateUser(session.profile.uid,{disabled:true});
  const disabled=await fetch('http://127.0.0.1:3000/api/admin/global-challenges?operation=list',{headers});
  assert.equal(disabled.status,401);
  console.log(JSON.stringify({project:process.env.FIREBASE_PROJECT_ID,normalList:200,disabledIdentity:401,realAuthAndFirestoreEmulators:true}));
} finally {
  host.kill('SIGTERM');
}
