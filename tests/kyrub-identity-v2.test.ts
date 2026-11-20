import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');
const css = read('src/index.css');
const logo = read('public/kyrub-logo.svg');

test('the Kyrub geometric pitanga seal is a small original vector with stem and leaves', () => {
  assert.match(logo, /viewBox="0 0 128 128"/);
  assert.match(logo, /<title id="title">Kyrub — selo da pitanga<\/title>/);
  assert.match(logo, /#F27429/);
  assert.match(logo, /#8FA893/);
  assert.match(logo, /caule e duas folhas verde-sálvia/);
  assert.match(logo, /<path fill="#F27429"/);
  assert.match(logo, /<circle/);
  assert.doesNotMatch(logo, /<image|data:image\/jpeg;base64,|<script|https?:\/\//);
  assert.ok(Buffer.byteLength(logo, 'utf8') < 9000, 'logo should render sharply at small sizes');
});

test('the five canonical colors are used by the global Tailwind utility palette', () => {
  for (const [key, hex] of Object.entries({
    '--color-slate-950': '#121A17',
    '--color-slate-900': '#1C2622',
    '--color-slate-500': '#8FA893',
    '--color-orange-500': '#F27429',
    '--color-slate-100': '#F5F0E6',
  })) {
    assert.ok(css.includes(`${key}: ${hex};`), `Missing canonical palette token ${key}`);
  }
  assert.match(css, /--kyrub-card-border: rgba\(143, 168, 147, 0\.2\)/);
  assert.match(css, /--color-teal-500: #8FA893/);
  assert.match(css, /kyrub-brand-wordmark/);
  assert.match(css, /kyrub-brand-hero/);
  assert.match(css, /kyrub-tone-raised/);
  assert.match(css, /kyrub-tone-editorial/);
  assert.match(css, /kyrub-tone-organic/);
  assert.match(css, /--kyrub-cream: #F5F0E6/);
  assert.doesNotMatch(css, /body:has\(\[data-kyrub-erp-viewport="true"\]\)[\s\S]{0,360}background: rgb\(2 6 23\)/);
});

test('guest entries alternate dark hero, raised cards, light editorial and orange CTA', () => {
  for (const source of ['src/components/LandingView.tsx', 'src/components/KyrubRendaEntryApp.tsx']) {
    const text = read(source);
    assert.match(text, /src="\/kyrub-logo\.svg"/);
    assert.match(text, /kyrub-brand-wordmark/);
    assert.match(text, /kyrub-brand-hero/);
    assert.match(text, /kyrub-editorial-heading/);
    assert.match(text, /kyrub-tone-organic/);
    assert.match(text, /kyrub-tone-raised/);
    assert.match(text, /kyrub-tone-editorial/);
    assert.match(text, /text-\[#121A17\]/);
  }
});

test('main workspace and guest workspace show the new brand without hiding existing tabs', () => {
  const app = read('src/LegacyApp.tsx');
  const guest = read('src/components/KyrubGuestWorkspace.tsx');
  const renda = read('src/components/tabs/RendaTab.tsx');
  const taba = read('src/components/tabs/KyrubTab.tsx');
  const learning = read('src/components/tabs/JemboeHabilidadesTab.tsx');
  assert.match(app, /id="kyrub-workspace-main" data-kyrub-workspace=\{activeTab\}/);
  assert.match(app, /id="kyrub-workspace-brand"/);
  assert.match(app, /src="\/kyrub-logo\.svg"/);
  assert.match(app, /data-kyrub-brand-panel="erp"/);
  assert.match(guest, /id="kyrub-guest-brand"/);
  assert.match(guest, /<RendaTab/);
  assert.match(renda, /data-kyrub-brand-panel="catu"/);
  assert.match(taba, /data-kyrub-brand-panel="taba"/);
  assert.match(taba, /kyrub-tone-organic mb-3/);
  assert.match(learning, /kyrub-tone-editorial/);
  assert.match(learning, /text-\[#121A17\]/);
  assert.match(learning, /bg-orange-500/);
});

test('installable Kyrub uses the new logo and deep-green browser chrome', () => {
  const html = read('index.html');
  const manifest = JSON.parse(read('public/site.webmanifest')) as {
    background_color: string; theme_color: string; icons: { src: string }[];
  };
  assert.match(html, /<meta name="theme-color" content="#121A17"/);
  assert.match(html, /href="\/kyrub-logo\.svg"/);
  assert.equal(manifest.background_color, '#121A17');
  assert.equal(manifest.theme_color, '#121A17');
  assert.ok(manifest.icons.some(icon => icon.src === '/kyrub-logo.svg'));
});
