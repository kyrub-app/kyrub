import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bridgeSource = readFileSync(
  'src/components/StoreOfferCardPresentationBridge.tsx',
  'utf8'
);
const wrapperSource = readFileSync(
  'src/components/tabs/KyrubTab.tsx',
  'utf8'
);
const globalCss = readFileSync('src/index.css', 'utf8');

test('offer store cards receive the published ERP keywords', () => {
  assert.match(bridgeSource, /formatStoreKeywords/);
  assert.match(bridgeSource, /store\.keywords/);
  assert.match(bridgeSource, /metadata\.dataset\.storeKeywords = keywords/);
  assert.match(bridgeSource, /Palavras-chave não informadas/);
  assert.match(wrapperSource, /<StoreOfferCardPresentationBridge/);
  assert.match(wrapperSource, /stores=\{publishedStores\}/);
});

test('offer cards gain three centimeters and replace the location row', () => {
  assert.match(globalCss, /height: calc\(156px \+ 3cm\)/);
  assert.match(globalCss, /\[data-store-keywords\][\s\S]*> span[\s\S]*display: none/);
  assert.match(globalCss, /content: attr\(data-store-keywords\)/);
});
