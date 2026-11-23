import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

test('Taba uses Freelas sage for the public and authenticated guide, while Catu keeps pumpkin', () => {
  const css = read('src/index.css');
  const guest = read('src/components/KyrubGuestWorkspace.tsx');
  const auth = read('src/LegacyApp.tsx');
  const renda = read('src/components/tabs/RendaTab.tsx');

  assert.match(css, /--color-teal-500: #8FA893/);
  assert.match(guest, /nextTab === 'praca' \? 'text-teal-400' : 'text-orange-500'/);
  assert.match(auth, /activeTab === 'kyrub' \? 'text-teal-400'/);
  assert.match(auth, /activeTab === 'renda' \? 'text-orange-500'/);
  assert.match(renda, /data-kyrub-brand-panel="catu"/);
  assert.match(renda, /bg-orange-600 py-2/);
  assert.match(renda, /Kyrub Freelas/);
  assert.match(renda, /text-orange-400/);
  assert.doesNotMatch(renda, /(?:bg|text|border)-(?:teal|cyan)-/);
  assert.doesNotMatch(css, /#renda-tab-container > \.grid:first-child > :nth-child\(2\)/);
});

test('Praça discovery and community interfaces keep a consistent sage highlight', () => {
  const sources = [
    'src/components/tabs/SquareStoresSection.tsx',
    'src/components/SquareDirectoryLayout.tsx',
    'src/components/GuestSquarePanel.tsx',
    'src/components/ProfileCommunitiesCloudBridge.tsx',
    'src/components/ProfileCommunitiesPreviewBridge.tsx',
    'src/components/CommunitySquareFeedCard.tsx',
  ];
  for (const path of sources) {
    const content = read(path);
    assert.doesNotMatch(content, /(?:sky|cyan)-[0-9]{3}/, path + ' retains previous blue accent');
    assert.match(content, /teal-[0-9]{3}/, path + ' needs sage accents');
  }
  const shops = read(sources[0]);
  const guest = read(sources[2]);
  const community = read(sources[3]);
  assert.match(shops, /text-teal-300">Lojas/);
  assert.match(shops, /bg-teal-500 px-3/);
  assert.match(guest, /text-teal-300">Comunidades/);
  assert.match(guest, /text-teal-300">Mural/);
  assert.match(community, /text-teal-300/);
  assert.match(community, /bg-teal-500/);
  assert.match(guest, /data-kyrub-brand-panel="taba"/);
  assert.match(read('src/components/tabs/KyrubTab.tsx'), /data-kyrub-brand-panel="taba"/);
});
