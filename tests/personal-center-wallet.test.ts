import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');
const app = read('src/LegacyApp.tsx');
const profile = read('src/components/modals/UserProfileModal.tsx');
const socialHub = read('src/components/ProfileSocialHubNative.tsx');
const wallet = read('src/components/modals/WalletModal.tsx');
const planner = read('src/components/PersonalFinancePlanner.tsx');
const pitangas = read('src/components/tabs/PitangaAccount.tsx');
const square = read('src/components/tabs/KyrubTab.tsx');

describe('Carteira e Central Pessoal', () => {
  test('header maintains identity, AI, tasks and notifications while moving Conectados/Salvos', () => {
    assert.match(app, /id="header-user-profile-trigger"/);
    assert.match(app, /id="header-kyrubia-trigger"/);
    assert.match(app, /id="header-tasks-trigger"/);
    assert.match(app, /id="header-connected-trigger"/);
    assert.match(app, /id="header-saved-trigger"/);
    assert.match(app, /new Event\('kyrub:open-connections'\)/);
    assert.doesNotMatch(app, /id="header-pitangas-trigger"/);
    assert.doesNotMatch(app, /id="header-wallet-balance"/);
    assert.match(socialHub, /window\.addEventListener\('kyrub:open-connections'/);
    assert.doesNotMatch(socialHub, /stopImmediatePropagation/);
  });

  test('profile icon reaches private central, preserving original edit flow and account settings', () => {
    assert.match(app, /setProfileOpenSaved\(false\); setShowUserProfileModal\(true\)/);
    assert.match(profile, /Central Pessoal/);
    assert.match(profile, /profile-personal-center/);
    assert.match(profile, /Editar perfil/);
    assert.match(profile, /window\.dispatchEvent\(new Event\('kyrub:open-profile-editor'\)\)/);
    assert.match(socialHub, /window\.addEventListener\('kyrub:open-profile-editor'/);
    assert.match(profile, /Conta e segurança/);
    assert.match(profile, /ProfileSettingsPanel/);
    assert.match(app, /walletHistory=\{walletHistory\}/);
  });

  test('Salvos opens existing private multi-source library from header', () => {
    assert.match(app, /setProfileOpenSaved\(true\); setShowUserProfileModal\(true\)/);
    assert.match(app, /openSavedInitially=\{profileOpenSaved\}/);
    assert.match(profile, /setIsSavedOpen\(openSavedInitially\)/);
    assert.match(profile, /subscribeSavedPublications/);
    assert.match(profile, /subscribeSelections/);
    assert.match(profile, /profile-saved-library/);
    assert.match(profile, /item\.sourceKind === 'community'/);
  });

  test('four panels are independent and have no duplicate Clubs card', () => {
    for (const title of ['Movimentações', 'Controle financeiro', 'Pitangas', 'XP e conquistas']) {
      assert.ok(profile.includes(title), title);
    }
    assert.match(profile, /<WalletMovementsPanel walletHistory=\{walletHistory\}/);
    assert.match(profile, /<PersonalFinancePlanner userId=\{currentUserId\}/);
    assert.match(profile, /<PitangaAccount mode="pitangas"/);
    assert.match(profile, /<PitangaAccount mode="xp"/);
    assert.doesNotMatch(profile, /id: 'clubs'/);
    assert.match(square, /aria-label="Meus clubes"/);
    assert.doesNotMatch(square, /<PitangaAccount/);
  });

  test('manual planning does not simulate a bank account or modify other users or store ERP', () => {
    assert.match(planner, /kyrub_personal_budget_v1_\$\{userId\}/);
    assert.match(planner, /localStorage\.setItem/);
    assert.match(planner, /entry\.kind === 'fixed'/);
    assert.match(planner, /entry\.month <= month/);
    assert.match(planner, /Receitas planejadas/);
    assert.match(planner, /Despesas planejadas/);
    assert.match(planner, /sem sincronização entre dispositivos/);
    assert.match(planner, /MAX_ITEMS = 200/);
    assert.match(planner, /crypto\.randomUUID\(\)/);
    assert.doesNotMatch(planner, /setDoc|deleteDoc|runTransaction|fetch\('/);
    assert.match(wallet, /WalletMovementsPanel/);
    assert.match(wallet, /não representam saldo/);
    assert.match(wallet, /Open Finance permanecerão indisponíveis/);
  });

  test('Pitangas and XP are views of the existing canonical account, not new balances', () => {
    assert.match(pitangas, /mode = 'all'/);
    assert.match(pitangas, /mode !== 'pitangas'/);
    assert.match(pitangas, /mode !== 'xp'/);
    assert.match(pitangas, /fetch\('\/api\/pitangas'/);
    assert.match(pitangas, /requestId: requestId\.current/);
    assert.match(pitangas, /1\.000 Pitangas = 1 XP/);
    assert.match(pitangas, /<SemeaduraJourneyPanel/);
  });

  test('legacy personal feed is no longer rendered while Praça and communities remain intact', () => {
    assert.match(socialHub, /const PERSONAL_FEED_RETIRED = true/);
    assert.match(socialHub, /!PERSONAL_FEED_RETIRED && activeTab === 'publications'/);
    assert.match(socialHub, /As publicações são feitas na Praça e nas Comunidades/);
    assert.match(square, /<PublicSocialFeedPanel/);
    assert.doesNotMatch(planner, /social_posts|community_posts/);
  });
});
