import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
test('social discovery consumers share a protected paginated directory',()=>{
 const paths=['src/LegacyApp.tsx','src/components/ProfileSocialHubNative.tsx','src/components/ProfileSocialHubBridge.tsx'];
 for(const path of paths){
  const source=readFileSync(path,'utf8');
  assert.match(source,/subscribeSocialDiscoveryDirectory\(/);
  assert.doesNotMatch(source,/onSnapshot\(collection\(db,\s*['"]users['"]\)/);
  assert.doesNotMatch(source,/listenCollection\(['"]users['"]/);
 }
 const native=readFileSync(paths[1],'utf8');
 assert.match(native,/IntersectionObserver/);
 assert.match(native,/directoryPage\.hasMore/);
 assert.match(native,/refreshSocialDiscoveryDirectory/);
 const hook=readFileSync('src/hooks/useSocialDirectoryV2.ts','utf8');
 assert.match(hook,/useSessionDirectoryState/);
 assert.match(hook,/protectedDirectory\?contactIdentities/);
 assert.match(hook,/protectedDirectory \? \{\} : \{/);
 const source=readFileSync('src/utils/socialDiscoveryDirectory.ts','utf8');
 assert.match(source,/session\.generation/);
 assert.match(source,/session\.controller\.abort\(\)/);
 assert.match(source,/if\(socialDirectoryPilotEnabled\(\)\)return subscribePilotDirectory/);
});
