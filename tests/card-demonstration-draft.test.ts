import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {EMPTY_CARD_DRAFT,normalizeCardDraft,loadCardDraft,saveCardDraft,clearCardDraft,cardDraftUrls,CARD_DRAFT_KEY} from '../src/utils/cardDemonstrationDraft';
const fake=()=>{const values=new Map<string,string>();return {getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};};
test('local demo draft is bounded, canonical and excludes unrelated fields',()=>{
 const s=fake(),draft={...EMPTY_CARD_DRAFT,name:'  Ana  ',profile:'@Ana',store:'@pizzaria',about:'Apresentação'};
 assert.equal(saveCardDraft(s,draft),true);
 assert.deepEqual(loadCardDraft(s),{...draft,name:'Ana',profile:'ana',store:'pizzaria'});
 assert.equal(loadCardDraft(s,'kyrub.card.demo.tag.other'),null);
 assert.deepEqual(cardDraftUrls(loadCardDraft(s)!),['https://kyrub.com/kairubido/ana','https://kyrub.com/@pizzaria']);
 for(const bad of [{...draft,profile:'https://evil.example'},{...draft,store:'../staff'},{...draft,name:'x'.repeat(81)}])assert.equal(normalizeCardDraft(bad),null);
 assert.deepEqual(normalizeCardDraft({...draft,secret:'not stored'}),{...draft,name:'Ana',profile:'ana',store:'pizzaria'});
 assert.equal(clearCardDraft(s,CARD_DRAFT_KEY),true);assert.equal(loadCardDraft(s),null);
});
test('demo never writes to server or authenticates visitors and keeps physical claim separate',()=>{
 const read=(p:string)=>readFileSync(p,'utf8');
 const demo=read('src/components/KyrubCardDemonstration.tsx'),app=read('src/App.tsx'),tag=read('src/components/PublicKyrubTagPage.tsx');
 assert.match(demo,/Cadastrar meu cartão/);
 assert.match(demo,/Kairub-se!/);
 assert.match(demo,/sessionStorage/);
 assert.doesNotMatch(demo,/fetch\(|setDoc\(|signInWith/);
 assert.match(app,/entry === 'card-demo'/);
 assert.match(tag,/Vincular esta tag física/);
 assert.match(tag,/claim-promotional/);
 assert.match(tag,/data.activation==='setup'/);
});

import {normalizeVisitCardPresentation,readVisitCardPresentation,hasVisitCardPresentation} from '../shared/visitCardPresentation';
test('independent presentation accepts text only and never private credentials',()=>{
 const sample={name:' Ana ',occupation:'Pizzaria',about:'Olá'};
 assert.deepEqual(normalizeVisitCardPresentation(sample),{...sample,name:'Ana'});
 assert.equal(hasVisitCardPresentation(normalizeVisitCardPresentation(sample)),true);
 assert.equal(readVisitCardPresentation({...sample,email:'private@example.test'}),undefined);
 assert.equal(readVisitCardPresentation({...sample,about:'x'.repeat(321)}),undefined);
 assert.equal(readVisitCardPresentation({...sample,occupation:42}),undefined);
});
test('independent card import requires explicit review and publication; preview cannot write presentation',()=>{
 const editor=readFileSync('src/components/MultifunctionCardEditor.tsx','utf8'),api=readFileSync('api/health.ts','utf8'),service=readFileSync('server/identity/publicVisitCardService.ts','utf8');
 assert.match(editor,/Aproveitar meu rascunho/);
 assert.match(editor,/!consent/);
 assert.match(editor,/clearCardDraft\(sessionStorage\)/);
 assert.match(api,/CARD_PREVIEW_READ_ONLY/);
 assert.match(api,/adminAuth.verifyIdToken\(bearer,true\)/);
 assert.match(service,/normalizeVisitCardPresentation\(rawPresentation\)/);
 assert.match(service,/tx.create\(ownerRef,\{id\}\)/);
});
