import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const landingSource = readFileSync(
  'src/components/LandingView.tsx',
  'utf8'
);
const indexSource = readFileSync('index.html', 'utf8');
const manifestSource = readFileSync('public/site.webmanifest', 'utf8');
const logoSource = readFileSync('public/kyrub-logo.svg', 'utf8');

test('landing uses the supplied Kyrub brand and focused hero copy', () => {
  assert.match(landingSource, /src="\/kyrub-logo\.svg"/);
  assert.match(logoSource, /viewBox="0 0 500 500"/);
  assert.match(logoSource, /data:image\/jpeg;base64,/);
  assert.match(logoSource, /<image width="500" height="500"/);
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

test('document registers the Kyrub logo as favicon and install icon', () => {
  assert.match(indexSource, /type="image\/svg\+xml"/);
  assert.match(indexSource, /\/kyrub-logo\.svg/);
  assert.match(indexSource, /\/site\.webmanifest/);
  assert.match(manifestSource, /\/kyrub-logo\.svg/);
  assert.match(manifestSource, /"sizes": "any"/);
});
