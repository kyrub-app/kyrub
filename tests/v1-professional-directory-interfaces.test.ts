import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
test('staff and administrative interfaces select protected transport without fallback on failure',()=>{
 const team=readFileSync('src/components/store/StoreTeamWorkspace.tsx','utf8');
 assert.match(team,/await searchStaffDirectoryPilot\(user,selectedAccess.store.id,term,inviteRole\)/);
 assert.match(team,/await inviteStaffDirectoryPilot\(user,selectedAccess.store.id,searchedTerm.current,inviteRole,targetUser.uid\)/);
 assert.match(team,/scope.revision===revision&&auth.currentUser===user/);
 assert.match(team,/currentScope.inviteRole!==inviteRole/);
 const directory=readFileSync('src/utils/adminDirectory.ts','utf8');
 assert.match(directory,/pilot&&session\?await lookupAdminDirectoryPilot/);
 assert.match(directory,/if\(!pilot\)void recordAdminDirectorySearch/);
 const overview=readFileSync('src/utils/adminControlPlane.ts','utf8');
 assert.match(overview,/await countAdminDirectoryUsersPilot\(session\)/);
 assert.match(overview,/if\(!pilot\)return countCollection\('users'\)/);
 for(const name of ['storeStaffDirectoryPilot','adminDirectoryPilot']){
  const source=readFileSync('src/utils/'+name+'.ts','utf8');
  assert.match(source,/DEV===true/);
  assert.match(source,/demo-kyrub-welcome/);
  assert.match(source,/auth.currentUser!==user/);
  assert.match(source,/cache:'no-store'/);
 }
});
