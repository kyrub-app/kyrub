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
