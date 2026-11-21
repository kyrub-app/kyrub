import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canReserveSocialAddress, isSocialAddress, projectSocialAddress } from '../server/identity/publicSocialAddressPolicy';
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
  assert.equal(canReserveSocialAddress('profile','uid-1','uid-1',{isProfileVisible:false}),false);
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
