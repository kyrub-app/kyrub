import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createTagPublicationReceipt, canReadPublishedPromotionalTag } from '../server/identity/kyrubTagPublicationPolicy.js';
import { TAG_PUBLICATION_TERMS_VERSION } from '../shared/kyrubTagPublicationTerms.js';
const actor='owner',id='a'.repeat(32),presentation={name:'Teste',occupation:'',about:''};
const age={uid:actor,status:'verified_adult'},acceptance={accepted:true,version:TAG_PUBLICATION_TERMS_VERSION};
const now='2026-11-25T12:00:00.000Z';
test('publication requires reliable age, explicit current acceptance and release flag',()=>{
 for(const status of ['pending','declared_adult','declared_underage','verified_underage','inconclusive','suspended'])
  assert.throws(()=>createTagPublicationReceipt(actor,id,presentation,acceptance,{uid:actor,status},true,now),/TAG_PUBLICATION_AGE_REQUIRED/);
 assert.throws(()=>createTagPublicationReceipt(actor,id,presentation,acceptance,age,false,now),/TAG_PUBLICATION_AGE_REQUIRED/);
 assert.throws(()=>createTagPublicationReceipt(actor,id,presentation,acceptance,{...age,uid:'other'},true,now),/TAG_PUBLICATION_AGE_REQUIRED/);
 for(const invalid of [null,{accepted:false,version:TAG_PUBLICATION_TERMS_VERSION},{accepted:true,version:'old'},{...acceptance,actor:'other'}])
  assert.throws(()=>createTagPublicationReceipt(actor,id,presentation,invalid,age,true,now),/TAG_PUBLICATION_TERMS_REQUIRED/);
});
test('public card and media require receipt bound to owner, tag, content and current age',()=>{
 const receipt=createTagPublicationReceipt(actor,id,presentation,acceptance,age,true,now);
 const data={distribution:'promotional',ownerId:actor,enabled:true,blocked:false,presentation,publicationReceipt:receipt};
 assert.equal(canReadPublishedPromotionalTag(id,data,age,true),true);
 for(const modified of [{enabled:false},{blocked:true},{publicationReceipt:null},{presentation:{...presentation,name:'Alterado'}},{ownerId:'other'}])
  assert.equal(canReadPublishedPromotionalTag(id,{...data,...modified},age,true),false);
 assert.equal(canReadPublishedPromotionalTag('b'.repeat(32),data,age,true),false);
 assert.equal(canReadPublishedPromotionalTag(id,data,{...age,status:'inconclusive'},true),false);
 assert.equal(canReadPublishedPromotionalTag(id,data,age,false),false);
 assert.equal(canReadPublishedPromotionalTag(id,data,undefined,true),false);
});
test('activation saves privately, public media and card share the policy',()=>{
 const page=readFileSync('src/components/PublicKyrubTagPage.tsx','utf8');
 const editor=readFileSync('src/components/PromotionalKyrubTagEditor.tsx','utf8');
 const service=readFileSync('server/identity/kyrubTagService.ts','utf8');
 const media=readFileSync('server/identity/kyrubTagMediaService.ts','utf8');
 assert.match(page,/request\('configure-promotional',\{presentation:draft\}\)/);
 assert.doesNotMatch(page,/request\('publish-promotional'/);
 assert.match(editor,/useState\(false\)/);
 assert.match(editor,/disabled=\{!accepted\|\|busy/);
 assert.match(service,/const enabled=acceptance!==undefined/);
 assert.match(service,/createTagPublicationReceipt\(actor,id,presentation,acceptance,age.data\(\)/);
 assert.match(service,/canReadPublishedPromotionalTag/);
 assert.match(media,/canReadPublishedPromotionalTag/);
 assert.match(media,/verifiedObject\(path,id,slot,data.ownerId\)/);
});
