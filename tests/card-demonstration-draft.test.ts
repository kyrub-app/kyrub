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
 assert.match(tag,/Cadastrar meu cartão/);
 assert.match(demo,/Kairub-se!/);
 assert.match(demo,/sessionStorage/);
 assert.doesNotMatch(demo,/fetch\(|setDoc\(|signInWith/);
 assert.match(app,/entry === 'card-demo'/);
 assert.match(tag,/sem criar um perfil completo no Kyrub/);
 assert.doesNotMatch(demo,/cardDraft=1/);
 assert.match(tag,/claim-promotional/);
 assert.match(tag,/data.activation==='setup'/);
});

import {normalizePromotionalPresentation,publicPromotionalPresentation} from '../shared/kyrubTagPromotional';
test('promotional card destinations are optional canonical public routes, never serialized as raw links',()=>{
 const base={name:'Ana',occupation:'Autônoma',about:'Apresentação'};
 const destinations=['https://kyrub.com/kairubido/ana','https://kyrub.com/@pizzaria','https://kyrub.com/comunidade/bairro'];
 assert.deepEqual(normalizePromotionalPresentation({...base,destinations}).destinations,destinations);
 assert.equal('destinations' in publicPromotionalPresentation({...base,destinations}),false);
 for(const invalid of [['https://evil.example/@loja'],['https://kyrub.com/cartao/abc'],[destinations[0],destinations[0]],['https://kyrub.com/@a','https://kyrub.com/@b']])assert.throws(()=>normalizePromotionalPresentation({...base,destinations:invalid}),/TAG_PRESENTATION_INVALID/);
});
test('publication reuses verified ownership and bound public destinations without creating a full account',()=>{
 const service=readFileSync('server/identity/kyrubTagService.ts','utf8'),page=readFileSync('src/components/PublicKyrubTagPage.tsx','utf8');
 assert.match(service,/assertTagPilotWriteIsolated/);
 assert.match(service,/resolveTarget\(actor,target,existing.find/);
 assert.match(service,/tx.update\(ref,\{presentation,targets,enabled:true/);
 assert.match(page,/presentation:currentPresentation\(\)/);
 assert.match(page,/data.links.map/);
});

test('Kairub-se opens the normal Renda landing without mandatory login or automatic return to tag',()=>{
 const demo=readFileSync('src/components/KyrubCardDemonstration.tsx','utf8');
 const page=readFileSync('src/components/PublicKyrubTagPage.tsx','utf8');
 const actions=readFileSync('src/components/KyrubTagPasskeyActions.tsx','utf8');
 const guest=readFileSync('src/components/KyrubGuestWorkspace.tsx','utf8');
 for(const source of [demo,page,actions]){
  assert.match(source,/<a[^>]*href="\/"[^>]*>Kairub-se!<\/a>/);
  assert.doesNotMatch(source,/<a[^>]*href="\/\?(?:app=1|entry=welcome|tagActivation)[^"]*"[^>]*>Kairub-se!/);
 }
 assert.doesNotMatch(actions,/tagActivation|entry=welcome/);
 assert.match(guest,/useState<GuestTab>\('renda'\)/);
 assert.match(guest,/id="kyrub-guest-signin"/);
 // The pre-existing reserved-unit flow remains independent.
 assert.match(page,/const loginPath='\/\?tagActivation='\+encodeURIComponent\(identifier\)/);
});
