import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const landingSource = readFileSync(
  'src/components/LandingView.tsx',
  'utf8'
);
const indexSource = readFileSync('index.html', 'utf8');
const manifestSource = readFileSync('public/site.webmanifest', 'utf8');

test('landing uses the supplied Kyrub brand and focused hero copy', () => {
  assert.match(landingSource, /src="\/kyrub-logo\.png"/);
  assert.match(landingSource, /Um app, muitas possibilidades/);
  assert.match(
    landingSource,
    /Tudo o que você precisa para organizar, conectar e crescer\./
  );
  assert.match(
    landingSource,
    /O Kyrub reúne ferramentas pessoais, sociais e comerciais/
  );
  assert.match(landingSource, /Entrar com Google/);
  assert.doesNotMatch(landingSource, />Entrar com Apple</);
});

test('about content is moved into an accessible modal', () => {
  assert.match(landingSource, /Sobre Kyrub/);
  assert.match(landingSource, /aria-haspopup="dialog"/);
  assert.match(landingSource, /role="dialog"/);
  assert.match(landingSource, /aria-modal="true"/);
  assert.match(landingSource, /event\.key === 'Escape'/);
  assert.match(landingSource, /document\.body\.style\.overflow = 'hidden'/);
  assert.match(landingSource, /featureCards\.map/);
  assert.match(landingSource, /trustItems\.map/);
});

test('document registers the complete Kyrub favicon set', () => {
  assert.match(indexSource, /\/favicon\.ico/);
  assert.match(indexSource, /\/favicon-32x32\.png/);
  assert.match(indexSource, /\/favicon-16x16\.png/);
  assert.match(indexSource, /\/apple-touch-icon\.png/);
  assert.match(indexSource, /\/site\.webmanifest/);
  assert.match(manifestSource, /android-chrome-192x192\.png/);
  assert.match(manifestSource, /android-chrome-512x512\.png/);
});
