import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canReserveSocialAddress, isSocialAddress, matchesSocialAddressRecord, projectSocialAddress } from '../server/identity/publicSocialAddressPolicy';
const profile={kind:'profile',identifier:'maufco',targetId:'uid-1'} as const;
const community={kind:'community',identifier:'nacao-roqueira',targetId:'community-1'} as const;
test('public social profile is explicit opt-in and contains no account data',()=>{
  const source={isProfileVisible:true,name:'Mundo Mau',email:'private@example.test',phone:'secret',uid:'uid-1'};
  assert.deepEqual(projectSocialAddress(profile,source,{name:"Mundo'Mau",bio:'Rock',photoUrl:'https://example.test/photo',email:'private@example.test'}),{kind:'profile',identifier:'maufco',name:"Mundo'Mau",description:'Rock',image:'https://example.test/photo'});
  assert.equal(projectSocialAddress(profile,{...source,isProfileVisible:false}),null);
  assert.equal(projectSocialAddress(profile,{name:'Missing consent'}),null);
  assert.equal(projectSocialAddress(profile,{isProfileVisible:true,email:'private@example.test'}),null);
  assert.equal(projectSocialAddress(profile,undefined),null);
});
test('community projection excludes private communities and internal data',()=>{
  const source={visibility:'moderated',name:'Nação Roqueira',description:'Rock',ownerId:'uid-1',rules:'private',memberCount:5};
  assert.deepEqual(projectSocialAddress(community,source),{kind:'community',identifier:'nacao-roqueira',name:'Nação Roqueira',description:'Rock',image:''});
  assert.equal(projectSocialAddress(community,{...source,visibility:'private'}),null);
});
test('only source owner can reserve an eligible social address',()=>{
  assert.equal(canReserveSocialAddress('profile','uid-1','uid-1',{isProfileVisible:true}),true);
  assert.equal(canReserveSocialAddress('profile','uid-2','uid-1',{isProfileVisible:true}),false);
  assert.equal(canReserveSocialAddress('profile','uid-1','uid-1',{isProfileVisible:false}),true);
  assert.equal(canReserveSocialAddress('profile','uid-1','uid-1',undefined),false);
  assert.equal(projectSocialAddress(profile,{isProfileVisible:false,name:'Privado'}),null);
  assert.equal(canReserveSocialAddress('community','uid-1','community-1',{ownerId:'uid-1',visibility:'public'}),true);
  assert.equal(canReserveSocialAddress('community','uid-2','community-1',{ownerId:'uid-1',visibility:'public'}),false);
  assert.equal(canReserveSocialAddress('community','uid-1','community-1',{ownerId:'uid-1',visibility:'private'}),false);
  for (const x of ['../staff','a/b','x','A','%2F','']) assert.equal(isSocialAddress('community',x),false);
});

import { resolveKyrubAppRoute } from '../src/utils/appRoutes';
test('public social routes are isolated from marketplace and legacy staff paths',()=>{
  assert.deepEqual(resolveKyrubAppRoute('/kairubido/maufco'),{kind:'public-profile',identifier:'maufco',canonicalPath:'/kairubido/maufco'});
  assert.deepEqual(resolveKyrubAppRoute('/comunidade/nacao-roqueira'),{kind:'public-community',identifier:'nacao-roqueira',canonicalPath:'/comunidade/nacao-roqueira'});
  assert.equal(resolveKyrubAppRoute('/comunidade/rocks/staff').kind,'invalid-public-social');
  assert.equal(resolveKyrubAppRoute('/@kyrub-oficial').kind,'public-storefront');
  assert.equal(resolveKyrubAppRoute('/do-mau/staff').kind,'staff-app');
});

test('address ownership proof rejects mismatched namespace, identifier and target',()=>{
 assert.equal(matchesSocialAddressRecord(profile,'profile','maufco','uid-1'),true);
 for(const record of [undefined,{...profile,kind:'community'},{...profile,identifier:'other'},{...profile,targetId:'uid-2'}])
  assert.equal(matchesSocialAddressRecord(record,'profile','maufco','uid-1'),false);
});


test('unified editor reserves a personal identifier without publishing it or deriving it from email',()=>{
 const editor=readFileSync('src/components/ProfilePublicIdentityEditor.tsx','utf8');
 const address=readFileSync('src/components/PublicSocialAddressEditor.tsx','utf8');
 const center=readFileSync('src/components/modals/UserProfileModal.tsx','utf8');
 const service=readFileSync('server/identity/publicSocialAddressService.ts','utf8');
 assert.match(editor,/<PublicSocialAddressEditor key=\{user.uid\} kind="profile" ownerId=\{user.uid\}/);
 assert.match(service,/publiclyVisible: kind === 'profile' \? source.isProfileVisible === true/);
 assert.match(address,/Reservar não torna seu perfil público/);
 assert.match(address,/disabled=\{!status\?\.publiclyVisible\}/);
 assert.match(center,/transport=manage-public-social-address&kind=profile/);
 assert.match(center,/auth\.currentUser===user/);
 assert.match(center,/Identificador ainda não definido/);
 assert.doesNotMatch(center,/getProfileHandle|@\{profileHandle\}/);
});

test('profile completion is triggered only after persisted profile save or confirmed reservation, not a catalog read',()=>{
 const editor=readFileSync('src/components/ProfilePublicIdentityEditor.tsx','utf8');
 const address=readFileSync('src/components/PublicSocialAddressEditor.tsx','utf8');
 const pilot=readFileSync('src/utils/profileCompletionPilot.ts','utf8');
 const router=readFileSync('server/gamification/profileCompletionEmulatorRouter.ts','utf8');
 const server=readFileSync('server.ts','utf8');
 const api=readFileSync('api/health.ts','utf8');
 assert.match(editor,/await batch.commit\(\);\s*if\(auth.currentUser!==user\)return;[\s\S]*?setMessage\('Foto, nome e biografia sincronizados\.'\);\s*void reconcileProfileCompletionPilot\(user\)/);
 assert.match(editor,/onReserved=\{\(\)=>void reconcileProfileCompletionPilot\(user\)\}/);
 assert.match(address,/if\(auth.currentUser===user\)[\s\S]*?onReserved\?\.\(\)/);
 assert.match(pilot,/import.meta.env\?\.DEV!==true/);
 assert.match(pilot,/auth.app.options.projectId!=='demo-kyrub-welcome'/);
 assert.match(pilot,/window.location.hostname!=='127.0.0.1'/);
 assert.match(pilot,/body:'\{\}'/);
 assert.match(pilot,/notifyRewardRefresh\(user,'profile_completion'\)/);
 assert.match(router,/req.method!=='POST'/);
 assert.match(router,/Object.keys\(req.body\).length/);
 assert.match(server,/KYRUB_PROFILE_COMPLETION_PILOT==='true'&&process.env.NODE_ENV==='test'/);
 assert.doesNotMatch(api,/profile-completion-pilot/);
});

test('social identity and collaborator picker do not display private contact data as profile attributes',()=>{
 const directory=readFileSync('src/hooks/useSocialDirectoryV2.ts','utf8');
 const picker=readFileSync('src/components/modals/UserSearchModal.tsx','utf8');
 assert.doesNotMatch(directory,/\.(?:email|whatsapp)\s*\|\|/);
 assert.match(directory,/user.isProfileVisible === true/);
 assert.match(picker,/data.isProfileVisible !== true/);
 assert.match(picker,/searchableEmail === normalizedSearch/);
 assert.doesNotMatch(picker,/searchableEmail\.includes|data.email.split|E-mail não informado/);
 // This is a presentation regression, not proof of database-level privacy.
});

test('both social discovery consumers use an opt-in query and minimized projection',()=>{
 const directory=readFileSync('src/utils/socialDiscoveryDirectory.ts','utf8');
 const hub=readFileSync('src/components/ProfileSocialHubNative.tsx','utf8');
 const legacy=readFileSync('src/LegacyApp.tsx','utf8');
 assert.match(directory,/where\('isProfileVisible','==',true\)/);
 assert.match(directory,/data.isProfileVisible!==true/);
 assert.match(directory,/auth.currentUser!==session/);
 assert.doesNotMatch(directory,/data\.email|data\.whatsapp|\.\.\.data/);
 assert.match(hub,/subscribeSocialDiscoveryDirectory\(directory.setDbUsers\)/);
 assert.doesNotMatch(hub,/profileHandle\(profile.email/);
 assert.match(legacy,/subscribeSocialDiscoveryDirectory\(setDbUsers\)/);
 assert.doesNotMatch(legacy,/listenCollection\('users'/);
});

test('legacy connected and mobile social bridges cannot enumerate unfiltered accounts',()=>{
 for(const file of ['ProfileConnectedGroupsBridge','ProfileSocialHubBridge','ProfileSocialMobileFirstBridge','ProfileConnectedCardsPolishBridge']){
  const source=readFileSync('src/components/'+file+'.tsx','utf8');
  assert.match(source,/subscribeSocialDiscoveryDirectory\(/,file);
  assert.doesNotMatch(source,/collection\(db,\s*['"]users['"]\)/,file);
 }
});

test('author presentation follows the current session without replacing immutable saved attribution',()=>{
 const author=readFileSync('src/hooks/useLiveAuthorIdentities.ts','utf8');
 const display=readFileSync('src/utils/authorDisplayIdentity.ts','utf8');
 const community=readFileSync('src/utils/communityPostConnections.ts','utf8');
 assert.match(author,/auth.onAuthStateChanged/);
 assert.match(author,/auth.currentUser!==session/);
 assert.match(author,/data\?\.isProfileVisible !== true \? ''/);
 assert.match(display,/current\[authorId\]\?\.name \|\| savedName/);
 assert.match(display,/current\[authorId\]\?\.avatar \?\? savedAvatar/);
 assert.match(community,/const visible = data.isProfileVisible === true/);
 assert.doesNotMatch(community,/user.displayName \|\| user.email/);
});

test('staff directory pilot is isolated and does not fall back after protected requests fail',()=>{
 const client=readFileSync('src/utils/storeStaffDirectoryPilot.ts','utf8');
 const workspace=readFileSync('src/components/store/StoreTeamWorkspace.tsx','utf8');
 const server=readFileSync('server.ts','utf8');
 assert.match(client,/import\.meta\.env\?\.DEV===true/);
 assert.match(client,/VITE_KYRUB_STAFF_DIRECTORY_PILOT==='true'/);
 assert.match(client,/auth\.app\.options\.projectId==='demo-kyrub-welcome'/);
 assert.match(client,/auth\.currentUser!==user/);
 assert.match(client,/method:'POST',cache:'no-store'/);
 assert.match(workspace,/staffDirectoryPilotEnabled\(\)\s*\?\s*await searchStaffDirectoryPilot/);
 assert.match(workspace,/await inviteStaffDirectoryPilot\(user,selectedAccess\.store\.id,searchedTerm\.current,inviteRole,targetUser\.uid\)/);
 assert.match(server,/KYRUB_STAFF_DIRECTORY_PILOT==='true'&&process\.env\.NODE_ENV==='test'/);
 assert.match(server,/routerPromise\?\?=Promise\.all/);
});
