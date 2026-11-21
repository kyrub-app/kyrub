import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPublicDestinationPath, buildPublicDestinationUrl, parsePublicDestinationPath, parsePublicDestinationUrl } from '../shared/publicDestinationRoutes';
import { publicBusinessCardUrl, publicStoreCardMessage } from '../src/utils/publicBusinessCard';

test('public addresses use independent namespaces and preserve storefront NFC addresses', () => {
  const cases = [
    ['store', 'kyrub-oficial', '/@kyrub-oficial'],
    ['profile', 'maufco', '/kairubido/maufco'],
    ['community', 'nacao-roqueira', '/comunidade/nacao-roqueira'],
    ['card', 'p8k2m', '/cartao/p8k2m'],
  ] as const;
  for (const [kind, identifier, path] of cases) {
    assert.equal(buildPublicDestinationPath(kind, identifier), path);
    assert.equal(buildPublicDestinationUrl(kind, identifier), 'https://kyrub.com' + path);
    assert.deepEqual(parsePublicDestinationPath(path), {kind, identifier});
    assert.deepEqual(parsePublicDestinationUrl('https://kyrub.com' + path), {kind, identifier});
  }
  assert.notEqual(buildPublicDestinationPath('profile', 'rock'), buildPublicDestinationPath('community', 'rock'));
  assert.equal(publicBusinessCardUrl('@kyrub-oficial'), 'https://kyrub.com/@kyrub-oficial');
  assert.deepEqual(publicStoreCardMessage('https://kyrub.com/@kyrub-oficial'), {records:[{recordType:'url',data:'https://kyrub.com/@kyrub-oficial'}]});
});
test('public addresses fail closed on malformed, private, external and ambiguous destinations', () => {
  for (const path of ['/staff','/api','/app','/maufco','/cartao/','/kairubido/../staff','/comunidade/rock/staff','/cartao/%2fstaff','/cartao/p8k2m?token=secret','/cartao/p8k2m#secret','/cartao//p8k2m','/@kyrub-oficial/','/cartao/UPPER','/cartao/'+'a'.repeat(121)]) {
    assert.equal(parsePublicDestinationPath(path), null, path);
  }
  for (const url of ['https://evil.example/cartao/p8k2m','https://kyrub.com.evil.example/cartao/p8k2m','http://kyrub.com/cartao/p8k2m','https://kyrub.com@evil.example/cartao/p8k2m']) assert.equal(parsePublicDestinationUrl(url), null, url);
  assert.equal(buildPublicDestinationPath('community','Nação Roqueira'),null);
  assert.equal(publicBusinessCardUrl('https://kyrub.com/cartao/p8k2m'),null); // not yet authorized by direct-store writer
});
