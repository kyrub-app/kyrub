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
 assert.match(api,/rotatePromotionalRecoveryCode\(actor,id\)/);
 assert.match(api,/configurePromotionalKyrubTag\(actor,id,data\.presentation\)/);
 assert.match(page,/claim-promotional/);
 assert.match(page,/recover-promotional/);
 assert.match(page,/SOS · Informações de emergência/);
 assert.match(page,/number:'190'/);
 assert.match(page,/number:'192'/);
 assert.match(page,/number:'193'/);
 assert.doesNotMatch(page,/instagram\.com/);
 assert.match(page,/sosContacts/);
 assert.match(page,/wa\.me/); // Optional WhatsApp belongs only to the SOS contact panel.
 assert.match(auth,/sendSignInLinkToEmail/);
 assert.match(auth,/signInWithEmailLink/);
 assert.doesNotMatch(auth,/actionCodeSettings.*email|[?&]email=/);
});

test('Personal Center uses promotional editor and never legacy WhatsApp/Instagram destination catalog',async()=>{
 const {readFileSync}=await import('node:fs');
 const panel=readFileSync('src/components/OfficialKyrubTagPanel.tsx','utf8');
 const promo=readFileSync('src/components/PromotionalKyrubTagEditor.tsx','utf8');
 const service=readFileSync('server/identity/kyrubTagService.ts','utf8');
 assert.match(panel,/import \{PromotionalKyrubTagEditor\}/);
 assert.match(panel,/selectedIsPromotional/);
 assert.match(panel,/selected&&!selectedIsPromotional/);
 assert.match(panel,/tag\?\.distribution==='promotional'&&<PromotionalKyrubTagEditor/);
 assert.match(panel,/tag\.distribution!=='promotional'&&<div/);
 assert.match(promo,/rotate-promotional-recovery/);
 assert.match(promo,/Gerar novo código de recuperação/);
 assert.match(service,/export async function rotatePromotionalRecoveryCode/);
 assert.match(service,/if\(current\.distribution==='promotional'\)throw Error\('TAG_FORBIDDEN'\)/);
});


test('promotional inventory is separate from pilot, NFC writes are non-overwriting, identity needs explicit full-account consent',async()=>{
 const {readFileSync}=await import('node:fs');
 const admin=readFileSync('src/components/admin/AdminControlPlaneApp.tsx','utf8');
 const batches=readFileSync('src/components/admin/AdminKyrubTagPromotionalBatches.tsx','utf8');
 const batchService=readFileSync('server/admin/kyrubTagPromotionalBatchService.ts','utf8');
 const app=readFileSync('src/App.tsx','utf8');
 const gate=readFileSync('src/components/KyrubTagOnlyEntry.tsx','utf8');
 const identity=readFileSync('server/identity/kyrubTagMinimalIdentityService.ts','utf8');
 const mail=readFileSync('src/components/TagEmailLinkIdentity.tsx','utf8');
 assert.match(admin,/AdminKyrubTagPromotionalBatches/);
 assert.match(admin,/admin-kyrub-tag-promotional/);
 assert.match(admin,/AdminKyrubTagPilot/);
 assert.match(batches,/Gravar em tag vazia/);
 assert.match(batches,/overwrite:false/);
 assert.match(batches,/physicalStatus:'not_verified'/);
 assert.doesNotMatch(batches,/e-mail da destinatária/i);
 assert.match(batchService,/KYRUB_TAG_PROMO_ISSUANCE_ENABLED/);
 assert.match(batchService,/actorRole:'super_admin'/);
 assert.match(batchService,/tagIds:ids/);
 assert.match(batchService,/tx\.create\(auditCollection\(\)\.doc/);
 assert.match(batchService,/if\(original\.count!==count\)throw Error\('TAG_BATCH_CONFLICT'\)/);
 assert.match(identity,/kyrub_tag_minimal_identities/);
 assert.match(identity,/source:'kyrub_tag_promo'/);
 assert.match(identity,/if\(account\.exists\|\|current\.get\('mode'\)==='full'\)/);
 assert.match(identity,/promoteTagIdentityToKyrub/);
 assert.match(app,/VITE_KYRUB_TAG_MINIMAL_IDENTITY_GATE/);
 assert.match(app,/KyrubTagOnlyEntry/);
 assert.match(app,/identityMode==='tag_only'/);
 assert.match(gate,/Quero criar minha conta Kairubido/);
 assert.match(gate,/promote-tag-identity/);
 assert.match(mail,/prepare-promotional-identity/);
});


test('SOS contacts are opt-in, private by default, and profile images require tag-local paths',async()=>{
 const {normalizePromotionalPresentation,publicPromotionalPresentation,isPromotionalMediaPath}=await import('../shared/kyrubTagPromotional');
 const id='a'.repeat(32),cover='kyrub-tag-media/'+id+'/cover/'+'b'.repeat(32);
 assert.equal(isPromotionalMediaPath(cover,id,'cover'),true);
 assert.equal(isPromotionalMediaPath(cover,id,'avatar'),false);
 assert.equal(isPromotionalMediaPath(cover,'c'.repeat(32),'cover'),false);
 const base={name:'Eu',occupation:'Entregador',about:'Contato em emergência'};
 const hidden={name:'Irmã',relationship:'Família',phone:'11 99999-0000',whatsapp:true,shareInSos:false,consentConfirmed:false};
 const permitted={name:'Amigo',relationship:'Confiança',phone:'+55 (11) 98888-0000',whatsapp:true,shareInSos:true,consentConfirmed:true};
 const normalized=normalizePromotionalPresentation({...base,emergencyContacts:[hidden,permitted],coverPath:cover});
 assert.equal(normalized.emergencyContacts?.length,2);
 assert.equal(normalized.emergencyContacts?.[0].phone,'+5511999990000');
 assert.equal(normalized.emergencyContacts?.[1].phone,'+5511988880000');
 const publicView=publicPromotionalPresentation(normalized);
 assert.equal(publicView.hasCover,true);
 assert.equal(publicView.hasAvatar,false);
 assert.deepEqual(publicView.sosContacts,[{name:'Amigo',relationship:'Confiança',phone:'+5511988880000',whatsapp:true}]);
 assert.equal(JSON.stringify(publicView).includes('Irmã'),false);
 assert.equal(JSON.stringify(publicView).includes('consentConfirmed'),false);
 assert.equal(JSON.stringify(publicView).includes(cover),false);
 for(const bad of [
  {...base,emergencyContacts:[{...hidden,shareInSos:true}]},
  {...base,emergencyContacts:[{...permitted,phone:'190'}]},
  {...base,emergencyContacts:[hidden,hidden,permitted]},
  {...base,emergencyContacts:[permitted,permitted]},
  {...base,coverPath:'https://othersite.com/cover.webp'},
  {...base,avatarPath:cover},
  {...base,emergencyContacts:[{...permitted,instagram:'somebody'}]}
 ])assert.throws(()=>normalizePromotionalPresentation(bad),/TAG_PRESENTATION_INVALID/);
 const photo=readFileSync('server/identity/kyrubTagMediaService.ts','utf8');
 const route=readFileSync('api/health.ts','utf8');
 const rules=readFileSync('storage.rules','utf8');
 assert.match(photo,/getPublicPromotionalTagImage/);
 assert.match(photo,/getMetadata/);
 assert.match(photo,/snapshot|snap\.updateTime/);
 assert.match(route,/public-kyrub-tag-media/);
 assert.match(route,/Cross-Origin-Resource-Policy/);
 assert.match(rules,/match \/kyrub-tag-media/);
 assert.match(rules,/request\.auth\.token\.email_verified/);
 assert.match(rules,/allow update, delete: if false/);
});
