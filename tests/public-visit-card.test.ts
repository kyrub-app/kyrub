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
