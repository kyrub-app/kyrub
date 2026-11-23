import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseCardTargets,cardLink,isCardId,isBoundTarget} from '../server/identity/publicCardPolicy';
import {resolveKyrubAppRoute} from '../src/utils/appRoutes';
test('multi destination card is bounded, typed and contains only canonical public URLs',()=>{
 const urls=['https://kyrub.com/kairubido/maufco','https://kyrub.com/@kyrub-oficial','https://kyrub.com/comunidade/nacao-roqueira'];
 const targets=parseCardTargets(urls);
 assert.equal(targets.length,3);
 assert.deepEqual(targets.map(t=>cardLink(t,'Destino').url),urls);
 for(const bad of [[],[urls[0],urls[0]],['https://evil.example/@shop'],['https://kyrub.com/staff'],['https://kyrub.com/cartao/abc'],['https://kyrub.com/@loja?token=secret'],Array.from({length:9},(_,i)=>'https://kyrub.com/@loja-'+i)])assert.throws(()=>parseCardTargets(bad),/INVALID_CARD/);
 assert.equal(isCardId('a'.repeat(32)),true);assert.equal(isCardId('maufco'),false);
 assert.equal(isBoundTarget({...targets[0],bindingId:'uid-1'}),true);
 assert.equal(isBoundTarget({...targets[0],bindingId:'../staff'}),false);
 assert.equal(resolveKyrubAppRoute('/cartao/'+'a'.repeat(32)).kind,'public-card');
 assert.equal(resolveKyrubAppRoute('/cartao/abc/staff').kind,'invalid-public-social');
});

test('public card links never serialize private binding data from stored targets',()=>{
 const stored={kind:'profile' as const,identifier:'maufco',bindingId:'private-uid',ownerId:'private-owner',email:'private@example.test'};
 assert.deepEqual(cardLink(stored,'Mundo Mau'),{kind:'profile',identifier:'maufco',name:'Mundo Mau',url:'https://kyrub.com/kairubido/maufco'});
});

test('approved tag personalization has four compact individually expandable destination rows',async()=>{
 const {readFileSync}=await import('node:fs');
 const panel=readFileSync('src/components/OfficialKyrubTagPanel.tsx','utf8');
 const row=readFileSync('src/components/KyrubTagDestinationRow.tsx','utf8');
 const page=readFileSync('src/components/PublicKyrubTagPage.tsx','utf8');
 assert.match(panel,/label="Meu perfil" icon=\{UserRound\}/);
 assert.match(panel,/label="Lojas e comunidades" icon=\{Store\}/);
 assert.match(panel,/\['whatsapp','instagram'\] as const/);
 assert.match(panel,/label=\{kind==='whatsapp'\?'WhatsApp':'Instagram'\}/);
 assert.match(row,/useState\(false\)/);
 assert.match(row,/aria-expanded=\{expanded\}/);
 assert.match(row,/expanded\?children:null/);
 assert.match(row,/bg-\[#121A17\]/);
 assert.match(row,/text-\[#F47825\]/);
 assert.match(panel,/Prévia dos destinos selecionados/);
 assert.match(panel,/Salvar minha Kyrub Tag/);
 assert.doesNotMatch(panel,/<select/);
 assert.match(page,/if\(authReady&&owner&&user\)return <main/);
});


test('promotional NFC stock is explicitly opt-in and cannot weaken protected or experimental units',async()=>{
 const {isOpenPromotionalTag,normalizePromotionalPresentation,EMPTY_PROMOTIONAL_PRESENTATION}=await import('../shared/kyrubTagPromotional');
 const open={distribution:'promotional',model:'adesivo',ownerId:null,enabled:false,activationHash:null,reservedEmailHash:null};
 assert.equal(isOpenPromotionalTag(open),true);
 for(const altered of [
  {...open,distribution:'protected'},
  {...open,model:'pulseira'},
  {...open,pilotBatch:'experimental-001',pilotSlot:'001'},
  {...open,reservedForUid:'another-user'},
  {...open,firstOwnerId:'previous-owner'},
  {...open,recoveryHash:'already-issued'},
  {...open,ownerId:'another-user'},
  {...open,enabled:true},
  {...open,activationHash:'secret-hash'},
  {...open,reservedEmailHash:'reserved'},
  {...open,blocked:true},
  {...open,distribution:undefined}
 ])assert.equal(isOpenPromotionalTag(altered),false);
 assert.deepEqual(normalizePromotionalPresentation(EMPTY_PROMOTIONAL_PRESENTATION),EMPTY_PROMOTIONAL_PRESENTATION);
 assert.deepEqual(normalizePromotionalPresentation({name:'  A  ',occupation:' Entregador ',about:'\u0000Minha apresentação'}),
  {name:'A',occupation:'Entregador',about:'Minha apresentação'});
 for(const invalid of [
  {name:'x'.repeat(81),occupation:'',about:''},
  {name:'',occupation:'x'.repeat(91),about:''},
  {name:'',occupation:'',about:'x'.repeat(321)},
  {name:'',occupation:'',about:'',email:'not-public'},
  {name:'',occupation:'',about:'',instagram:'not-public'}
 ])assert.throws(()=>normalizePromotionalPresentation(invalid),/TAG_PRESENTATION_INVALID/);
});

test('promo tag uses verified e-mail and transactional claim; public card carries SOS not social sign-in',async()=>{
 const {readFileSync}=await import('node:fs');
 const service=readFileSync('server/identity/kyrubTagService.ts','utf8');
 const api=readFileSync('api/health.ts','utf8');
 const page=readFileSync('src/components/PublicKyrubTagPage.tsx','utf8');
 const auth=readFileSync('src/components/TagEmailLinkIdentity.tsx','utf8');
 assert.match(service,/KYRUB_TAG_PROMO_FIRST_CLAIM_ENABLED/);
 assert.match(service,/if\(!promotionalEnabled\(\)\)throw Error\('TAG_PROMO_DISABLED'\)/);
 assert.match(service,/isOpenPromotionalTag\(data\)/);
 assert.match(service,/adminDb\.runTransaction/);
 assert.match(service,/ownerId:actor,firstOwnerId:actor/);
 assert.match(service,/recoveryHash:promotionalRecoveryHash/);
 assert.match(service,/timingSafeEqual/);
 assert.match(service,/distribution!=='promotional'/);
 assert.match(service,/initial\.distribution==='promotional'/);
 assert.match(service,/current\.distribution==='promotional'/);
 assert.match(api,/identity\.emailVerified!==true/);
 assert.match(api,/claimPromotionalKyrubTag\(actor,id,identity\.email\)/);
 assert.match(api,/recoverPromotionalKyrubTag\(actor,id,identity\.email,data\.recoveryCode\)/);
 assert.match(api,/configurePromotionalKyrubTag\(actor,id,data\.presentation\)/);
 assert.match(page,/claim-promotional/);
 assert.match(page,/recover-promotional/);
 assert.match(page,/SOS · Informações de emergência/);
 assert.match(page,/number:'190'/);
 assert.match(page,/number:'192'/);
 assert.match(page,/number:'193'/);
 assert.doesNotMatch(page,/instagram\.com|wa\.me/);
 assert.match(auth,/sendSignInLinkToEmail/);
 assert.match(auth,/signInWithEmailLink/);
 assert.doesNotMatch(auth,/actionCodeSettings.*email|[?&]email=/);
});
