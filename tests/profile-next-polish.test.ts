import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync('src/main.tsx', 'utf8');
const polishSource = readFileSync(
  'src/components/ProfileNextPolishBridge.tsx',
  'utf8'
);

test('moves Praça from the duplicated tab row into the profile header actions', () => {
  assert.match(mainSource, /<ProfileNextPolishBridge\s*\/?>/);
  assert.match(polishSource, /aria-label="Abrir Praça"/);
  assert.match(polishSource, /profile-square-shortcut-slot/);
  assert.match(polishSource, /buttonWithText\(profileNavigation, 'Praça'\)/);
  assert.match(polishSource, /squareButton\.style\.display = 'none'/);
  assert.match(polishSource, /repeat\(3, minmax\(0, 1fr\)\)/);
});

test('places Docs, Bio and Face beside the profile photo controls', () => {
  assert.match(polishSource, /Atalhos seguros do perfil/);
  assert.match(polishSource, /label: 'Docs'/);
  assert.match(polishSource, /label: 'Bio'/);
  assert.match(polishSource, /label: 'Face'/);
  assert.match(polishSource, /controls\.appendChild\(target\)/);
  assert.match(polishSource, /photoRow\.insertAdjacentElement\('afterend', contentTarget\)/);
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
