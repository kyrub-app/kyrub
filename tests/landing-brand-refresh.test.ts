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

test('landing uses the supplied Kyrub brand and makes Renda the guest entry', () => {
  assert.match(landingSource, /src="\/kyrub-logo\.svg"/);
  assert.match(logoSource, /viewBox="0 0 500 500"/);
  assert.match(logoSource, /data:image\/jpeg;base64,/);
  assert.match(logoSource, /<image width="500" height="500"/);
  assert.match(landingSource, /data-kyrub-guest-entry="renda"/);
  assert.match(landingSource, /Renda é a sua porta de entrada/);
  assert.match(
    landingSource,
    /Descubra o que você pode fazer, prestar ou vender no Kyrub\./
  );
  assert.match(landingSource, /Explore sem compromisso/);
  assert.match(landingSource, /Entrar com Google/);
  assert.doesNotMatch(landingSource, />Entrar com Apple</);
});

test('guest landing preserves browsing context and explicit authentication boundaries', () => {
  assert.match(landingSource, /loadStorefrontOriginContext/);
  assert.match(landingSource, /id="guest-return-to-origin-store"/);
  assert.match(landingSource, /props\.handleLogin\('google'\)/);
  assert.match(landingSource, /rendaCards\.map/);
  assert.match(landingSource, /ecosystemCards\.map/);
  assert.match(
    landingSource,
    /window\.history\.pushState\(\{\}, '', '\/staff'\)/
  );
  assert.match(landingSource, /props\.setCurrentPath\('\/staff'\)/);
});

test('document registers the Kyrub logo as favicon and install icon', () => {
  assert.match(indexSource, /type="image\/svg\+xml"/);
  assert.match(indexSource, /\/kyrub-logo\.svg/);
  assert.match(indexSource, /\/site\.webmanifest/);
  assert.match(manifestSource, /\/kyrub-logo\.svg/);
  assert.match(manifestSource, /"sizes": "any"/);
});
