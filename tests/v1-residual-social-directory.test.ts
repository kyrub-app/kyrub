import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
test('remaining social bridge paths do not enumerate root accounts',()=>{
 for(const name of ['ProfileConnectedGroupsBridge','ProfileSocialMobileFirstBridge']){
  const source=readFileSync('src/components/'+name+'.tsx','utf8');
  assert.match(source,/subscribeSocialDiscoveryDirectory\(directory.setDbUsers\)/);
  assert.doesNotMatch(source,/onSnapshot\(collection\(db, 'users'\)/);
 }
 const polish=readFileSync('src/components/ProfileConnectedCardsPolishBridge.tsx','utf8');
 assert.doesNotMatch(polish,/collection\(db, 'users'\)/);
 assert.match(polish,/where\('participantIds','array-contains',user.uid\)/);
 assert.match(polish,/matches.length===1/);
});
test('community author identity uses protected projection and no private fallback when enabled',()=>{
 const source=readFileSync('src/utils/communityPostConnections.ts','utf8');
 assert.ok(source.indexOf('await readAuthorIdentitiesPilot(session,[userId])')<source.indexOf("await getDoc(doc(db, 'users', userId))"));
 assert.match(source,/visible:!!profile/);
 assert.match(source,/if \(auth.currentUser!==user\)/);
 assert.doesNotMatch(source,/user.displayName \|\| user.email/);
});
