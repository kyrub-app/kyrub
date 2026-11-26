import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
test('private directory reuses existing multiplexer and keeps independent server release guard',()=>{
 const api=readFileSync('api/health.ts','utf8');
 const start=api.indexOf("if (transport === 'private-identity-directory')");
 assert.ok(start>=0);
 const branch=api.slice(start,api.indexOf("if (transport === 'official-operational-phase')",start));
 assert.ok(branch.includes("process.env.KYRUB_PRIVATE_DIRECTORY_RELEASE_ENABLED !== 'true'"));
 assert.ok(branch.indexOf('DIRECTORY_DISABLED')<branch.indexOf('await import'));
 assert.ok(branch.includes('handlePrivateDirectoryRequest(request,response)'));
 const client=readFileSync('src/utils/privateDirectoryClientTransport.ts','utf8');
 assert.ok(client.includes('VITE_KYRUB_PRIVATE_DIRECTORY_SOCIAL_ENABLED'));
 assert.ok(client.includes('VITE_KYRUB_PRIVATE_DIRECTORY_ADMIN_ENABLED'));
 assert.ok(client.includes('PROD===true'));
 assert.ok(client.includes("projectId==='kyrub-b8d0e'"));
 assert.ok(client.includes("'/api/health?transport=private-identity-directory'"));
 for(const scope of ['social','admin']){
  const source=readFileSync('src/utils/'+scope+'DirectoryPilot.ts','utf8');
  assert.ok(source.includes("privateDirectoryProductionEnabled('"+scope+"')"));
  assert.ok(source.includes("privateDirectoryRequest('"+scope+"'"));
  assert.ok(source.includes('auth.currentUser!==user'));
 }
 const staff=readFileSync('src/utils/storeStaffDirectoryPilot.ts','utf8');
 assert.ok(!staff.includes('privateDirectoryProductionEnabled'));
});
