import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync('src/main.tsx', 'utf8');
const polishSource = readFileSync(
  'src/components/ProfileNextPolishBridge.tsx',
  'utf8'
);

test('polish never injects duplicate header controls', () => {
  assert.ok(mainSource.includes('<ProfileNextPolishBridge />'));
  assert.ok(!polishSource.includes('personalPageHeaderTarget'));
  assert.ok(!polishSource.includes('personal-page-header-slot'));
  assert.ok(!polishSource.includes("getElementById('app-header')"));
  assert.ok(!polishSource.includes('header-user-profile-trigger'));
});

test('places Docs, Bio and Face beside the profile photo controls', () => {
  assert.match(polishSource, /Atalhos seguros do perfil/);
  assert.match(polishSource, /label: 'Docs'/);
  assert.match(polishSource, /label: 'Bio'/);
  assert.match(polishSource, /label: 'Face'/);
  assert.match(polishSource, /controls\.appendChild\(target\)/);
  assert.ok(polishSource.includes('photoRow.insertAdjacentElement('));
  assert.ok(polishSource.includes("'afterend',"));
  assert.ok(polishSource.includes('contentTarget'));
  assert.match(polishSource, /grid grid-cols-3/);
});

test('uses the sixth metrics tile for sponsorship and adds sponsored publications', () => {
  assert.match(polishSource, /profile-metrics-sponsor-slot/);
  assert.match(polishSource, /Patrocinar publicação/);
  assert.match(polishSource, /Publicações patrocinadas/);
  assert.match(polishSource, /Nenhuma campanha ativa/);
  assert.match(polishSource, /kyrub-sponsored-posts-open-requested/);
});

test('keeps the iterative polish free from mutation observers', () => {
  assert.doesNotMatch(polishSource, /MutationObserver/);
  assert.match(polishSource, /window\.setInterval\(synchronize, 250\)/);
});
