import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');
const app = read('src/LegacyApp.tsx');
const navigation = read('src/components/WorkspaceTopNavigation.tsx');
const profile = read('src/components/modals/UserProfileModal.tsx');
const socialHub = read('src/components/ProfileSocialHubNative.tsx');
const unifiedEditor = read('src/components/ProfileVerificationBridge.tsx');
const wallet = read('src/components/modals/WalletModal.tsx');
const planner = read('src/components/PersonalFinancePlanner.tsx');
const pitangas = read('src/components/tabs/PitangaAccount.tsx');
const square = read('src/components/tabs/KyrubTab.tsx');

describe('Carteira e Central Pessoal', () => {
  test('header maintains identity, AI, tasks and notifications while moving Conectados/Salvos', () => {
    assert.match(app, /<WorkspaceTopNavigation/);
    assert.match(navigation, /id="header-user-profile-trigger"/);
    assert.match(navigation, /id="header-kyrubia-trigger"/);
    assert.match(navigation, /id="header-tasks-trigger"/);
    assert.match(navigation, /id="header-connected-trigger"/);
    assert.match(navigation, /id="header-saved-trigger"/);
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
    assert.match(profile, /id="personal-profile-settings-trigger"/);
    assert.match(profile, /aria-label="Editar perfil"/);
    assert.match(profile, /window\.dispatchEvent\(new Event\('kyrub:open-unified-profile-editor'\)\)/);
    assert.match(unifiedEditor, /window\.addEventListener\('kyrub:open-unified-profile-editor'/);
    assert.doesNotMatch(profile, />\s*Conta e segurança\s*</);
    assert.match(profile, /id="personal-profile-visibility"/);
    assert.doesNotMatch(profile, /ProfileSettingsPanel|kyrub:open-profile-settings/);
    assert.match(unifiedEditor, /<ProfilePublicIdentityEditor user=\{user\}/);
    assert.match(app, /walletHistory=\{walletHistory\}/);
  });

  test('guest login and authenticated logout share the scrolling brand position', () => {
    const guest = read('src/components/KyrubGuestWorkspace.tsx');
    assert.match(app, /id="kyrub-workspace-signout"/);
    assert.match(app, /onClick=\{\(\) => void handleLogout\(\)\}/);
    assert.match(app, /disabled=\{isSigningOut\}/);
    assert.match(app, /await signOut\(auth\)/);
    assert.match(app, /retainedWorkspaceTabByUser\.delete\(signingOutUid\)/);
    assert.match(guest, /id="kyrub-guest-signin"/);
    assert.match(guest, /requestLogin\('acessar sua conta'\)/);
    assert.match(guest, /signInWithPopup\(auth, provider\)/);
    assert.match(app, /id="kyrub-workspace-brand" className="flex min-h-10/);
    assert.match(guest, /id="kyrub-guest-brand" className="flex min-h-10/);
    assert.doesNotMatch(profile, /personal-profile-auth-trigger|onAuthAction|isAuthBusy/);
    assert.match(profile, /id="personal-profile-settings-trigger"/);
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

  test('Central Pessoal preserves wallet areas and adds devices alongside achievements', () => {
    const cards = profile.slice(profile.indexOf('const financeCards = ['), profile.indexOf('] as const;', profile.indexOf('const financeCards = [')));
    const cardIds = [...cards.matchAll(/\{ id: '(\w+)'/g)].map(match => match[1]);
    assert.deepEqual(cardIds, ['movements', 'finance', 'xp', 'devices', 'challenges']);
    assert.doesNotMatch(cards, /id: 'pitangas'/);
    assert.match(profile, /card\.id === 'challenges' \? 'col-span-2'/);
    assert.match(profile, /<WalletMovementsPanel walletHistory=\{walletHistory\}/);
    assert.match(profile, /<PersonalFinancePlanner userId=\{currentUserId\}/);
    assert.match(profile, /<PitangaAccount mode="xp"/);
    assert.doesNotMatch(profile, /<PitangaAccount mode="pitangas"/);
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

  test('Cocares, real Pitangas balance, conversion and statement share the existing canonical account', () => {
    assert.match(pitangas, /mode = 'all'/);
    assert.match(pitangas, /mode === 'xp'/);
    assert.match(pitangas, /Pitangas disponíveis/);
    assert.match(pitangas, /account\.pitangas\.toLocaleString\('pt-BR'\)/);
    assert.match(pitangas, /fetch\('\/api\/pitangas'/);
    assert.match(pitangas, /requestId: requestId\.current/);
    assert.match(pitangas, /1\.000 Pitangas = 1 Cocar/);
    assert.match(pitangas, /<SemeaduraJourneyPanel/);
    assert.match(pitangas, /xp=\{mode === 'xp' \? \(account\?\.xp \?\? null\) : undefined\}/);
    assert.match(pitangas, /Extrato de recompensas/);
    assert.match(pitangas, /saldo de Pitangas creditadas não se confunde com sementes/);
    assert.doesNotMatch(pitangas, /{mode === 'xp'\s*\? \x60\$\{account\.xp/);
  });

  test('legacy personal feed is no longer rendered while Praça and communities remain intact', () => {
    assert.match(socialHub, /const PERSONAL_FEED_RETIRED = true/);
    assert.match(socialHub, /!PERSONAL_FEED_RETIRED && activeTab === 'publications'/);
    assert.match(socialHub, /As publicações são feitas na Praça e nas Comunidades/);
    assert.match(square, /<PublicSocialFeedPanel/);
    assert.doesNotMatch(planner, /social_posts|community_posts/);
  });
});

test('personal receiving settings remain isolated, private and inside Movimentações',()=>{
 const settings=read('src/components/modals/PersonalPixSettings.tsx');
 assert.match(wallet,/personalFinanceCandidateEnabled\(\) && <PersonalPixSettings/);
 assert.match(settings,/import\.meta\.env\.DEV/);
 assert.match(settings,/VITE_KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION/);
 assert.match(settings,/VITE_KYRUB_FIREBASE_EMULATOR_E2E/);
 assert.match(settings,/kyrub-security-test/);
 assert.match(settings,/onAuthStateChanged/);
 assert.match(settings,/expectedRevision:current\.revision/);
 assert.match(settings,/ownershipVerified===false/);
 assert.doesNotMatch(settings,/localStorage|sessionStorage|console\./);
});

test('CID import in Movimentações uses server candidates and separate confirmation',()=>{
 const settings=read('src/components/modals/PersonalPixSettings.tsx');
 assert.match(settings,/view=cid_candidates/);
 assert.match(settings,/validCandidates\(list\)/);
 assert.match(settings,/cidConfirmed/);
 assert.match(settings,/sourceVersion:candidate.sourceVersion/);
 assert.match(settings,/replaceExisting:current.status==='declared'/);
 assert.match(settings,/Utilizar chave Pix do meu CID/);
 assert.match(settings,/setCandidates\(\[\]\)/);
});

test('private experience and reputation are outside reward wallet and verify minimal scoped projections',async()=>{
 const {validVerifiedReputationView}=await import('../src/components/modals/verifiedReputationView');
 const {emptyReputationAccumulator,projectReputationAccumulator}=await import('../shared/freelanceReputationAccumulator');
 const kind='professional',id='fixture-user';
 const projection=projectReputationAccumulator(kind,emptyReputationAccumulator(kind));
 const v={subject:{kind,id},state:'verified_snapshot',projection};
 assert.equal(validVerifiedReputationView(v,kind,id),true);
 assert.equal(validVerifiedReputationView(v,kind,'outsider'),false);
 assert.equal(validVerifiedReputationView({...v,state:'repair_required'},kind,id),false);
 assert.equal(validVerifiedReputationView({...v,state:'repair_required',projection:null},kind,id),true);
 assert.equal(validVerifiedReputationView({...v,projection:{...projection,aggregate:{...projection.aggregate,mean:5}}},kind,id),false);
 assert.equal(validVerifiedReputationView({...v,missingReceipts:0},kind,id),false);
 const ui=read('src/components/modals/PersonalReputationPanel.tsx');
 assert.match(profile,/personalReputationCandidateEnabled\(\) && <div/);
 assert.match(profile,/<PersonalReputationPanel key=\{currentUserId\}/);
 assert.match(ui,/VITE_KYRUB_FREELANCE_REPUTATION_INDEX_TEST_ONLY/);
 assert.match(ui,/onAuthStateChanged/);assert.match(ui,/auth.currentUser!==user/);assert.match(ui,/cache:'no-store'/);
 assert.match(ui,/data\?\.state==='verified_snapshot'&&p/);
 assert.doesNotMatch(ui,/method:'POST'|localStorage|rewardXp/);
});

test('store reputation operational and management destinations preserve distinct authority',()=>{
 const menu=read('src/components/MobileErpMenu.tsx'),runtime=read('src/components/MobileErpMenuRuntime.tsx'),router=read('src/components/RetailerPanelRuntimeRouter.tsx');
 assert.match(menu,/id: 'reputacoes', label: 'Reputações', icon: Star, section: 'operacao'/);
 assert.match(menu,/itemId === 'ponto' \|\| itemId === 'reputacoes'/);
 assert.match(runtime,/storeReputationCandidateEnabled\(\)/);
 assert.match(router,/props.activeSubTab === 'reputacoes'/);
 const ui=read('src/components/store/StoreReputationWorkspace.tsx');
 assert.match(ui,/view=reputation_team&storeId=/);assert.match(ui,/method:'GET'/);assert.match(ui,/cache:'no-store'/);
 assert.doesNotMatch(ui,/method:'POST'|localStorage|contest_reputation|submit_reputation/);
});

test('management Reputações remains separate from operational team view and reuses existing reporting',()=>{
 const menu=read('src/components/MobileErpMenu.tsx'),router=read('src/components/RetailerPanelRuntimeRouter.tsx');
 assert.match(menu,/id: 'reputacoes_gestao', label: 'Reputações', icon: Star, section: 'gestao'/);
 assert.match(menu,/itemId === 'reputacoes_gestao'\) return role === 'manager'/);
 assert.match(router,/moduleId === 'reputacoes_gestao'/);
 const ui=read('src/components/store/StoreReputationManagementWorkspace.tsx');
 assert.match(ui,/view=reputation_management&storeId=/);assert.match(ui,/submitStoreReviewReport\(report.storeId,report.reviewId,reason\)/);
 assert.match(ui,/<FreelaReputationPanel/);assert.match(ui,/view.owner\?/);
 assert.doesNotMatch(ui,/deleteDoc|updateDoc|localStorage/);
});

test('management reputation uses bounded forward pages with the current report scope',()=>{
 const ui=read('src/components/store/StoreReputationManagementWorkspace.tsx');
 assert.match(ui,/Próxima página/);assert.match(ui,/Voltar à primeira página/);
 assert.match(ui,/fetch\(url\(pageCursor\)/);
 assert.match(ui,/encodeURIComponent\(cursor\)/);
});

test('public profile experience uses canonical address and isolated authenticated consultation',()=>{
 const page=read('src/components/PublicSocialDestinationPage.tsx'),ui=read('src/components/PublicProfileExperience.tsx');
 assert.match(page,/data.kind==='profile'&&publicExperienceCandidateEnabled\(\)/);
 assert.match(page,/data.identifier===identifier/);
 assert.match(ui,/reputation_public_address_experience&identifier=/);
 assert.match(ui,/cache:'no-store'/);assert.match(ui,/VITE_KYRUB_FREELANCE_PUBLIC_EXPERIENCE_TEST_ONLY/);
 assert.match(ui,/auth.currentUser!==user/);assert.match(ui,/validPublicExperienceResponse/);
 assert.doesNotMatch(ui,/targetUid|localStorage|method:'POST'|criteria|authorUid/);
 assert.match(ui,/reputation_public_address_summary&identifier=/);
 assert.match(ui,/VITE_KYRUB_FREELANCE_PUBLIC_REPUTATION_TEST_ONLY/);
 assert.match(ui,/validPublicSummaryResponse/);
 assert.match(ui,/r.ratingCount<=max/);
});

test('reputation sharing uses a server-derived card preview instead of a profile link',()=>{
 const modal=read('src/components/modals/UserProfileModal.tsx'),panel=read('src/components/modals/PersonalReputationPanel.tsx'),preview=read('src/components/ReputationSquarePreview.tsx');
 assert.match(modal,/visibleIdentifier=\{profileVisibilityReady&&isProfileVisible&&!visibilityBusy/);
 assert.match(panel,/<ReputationSquarePreview/);
 assert.match(preview,/reputation_square_preview&identifier=/);
 assert.match(preview,/validPublicSummaryResponse/);
 assert.match(preview,/Serviços concluídos/);assert.match(preview,/Contratações concluídas/);
 assert.match(preview,/Semear/);assert.match(preview,/Comentar/);assert.match(preview,/Encaminhar/);
 assert.doesNotMatch(panel+preview,/navigator.clipboard|buildPublicDestinationUrl|setDoc\(|addDoc\(|localStorage|rewardXp/);
 assert.match(preview,/action:'publish_reputation_square',identifier,requestId:requestId.current,confirmed:true/);
 assert.match(preview,/requestId.current\?\?=crypto.randomUUID/);
 assert.match(preview,/value\?\.confirmed!==true/);
});

test('reputation square publication renders verified indicators only in the visible feed card',()=>{
 const feed=read('src/components/PublicSocialFeedPanel.tsx'),preview=read('src/components/ReputationSquarePreview.tsx');
 assert.match(feed,/<ReputationSquarePostGate/);assert.match(feed,/<ReputationPublicationIndicators summary=\{summary\}/);
 assert.match(preview,/new IntersectionObserver/);assert.match(preview,/reputation_square_post&offerId=/);
 assert.match(preview,/Date.now\(\)<expiresAt/);assert.match(preview,/visible&&tabVisible&&summary\?render\(summary\)/);
 assert.match(preview,/VITE_KYRUB_FREELANCE_REPUTATION_SQUARE_PUBLISH_TEST_ONLY/);
 assert.match(feed,/<SemearButton kind="personal"/);assert.match(feed,/toggleComments\(post.id\)/);
});

test('reputation forwarding uses one original post and separate distribution time',()=>{
 const feed=read('src/components/PublicSocialFeedPanel.tsx'),preview=read('src/components/ReputationSquarePreview.tsx'),hook=read('src/hooks/usePublicSocialFeed.ts');
 assert.match(hook,/reputationSquareDistribution:/);assert.match(hook,/squareDistributedAtIso/);
 assert.match(feed,/createdAt: squareDistributionTime\(post\), post/);
 assert.match(feed,/createdAt=\{squareDistributionTime\(post\)\}/);
 assert.match(feed,/Encaminhada à Praça por/);
 assert.match(feed,/<ReputationSquareForwardButton postId=\{post.id\}/);
 assert.match(preview,/action:'forward_reputation_square',offerId:postId,destination:'square',confirmed:true/);
 assert.match(preview,/VITE_KYRUB_FREELANCE_REPUTATION_SQUARE_FORWARD_TEST_ONLY/);
 assert.doesNotMatch(preview,/setDoc\(|addDoc\(|localStorage/);
});

test('connected reputation share uses accepted contacts and protected chat read',()=>{
 const ui=read('src/components/ReputationSquarePreview.tsx'),chat=read('src/components/modals/ChatModal.tsx'),hook=read('src/hooks/useChatMessages.ts');
 assert.match(ui,/f.connectionStatus==='accepted'/);assert.match(ui,/action:'forward_reputation_connected'/);
 assert.match(ui,/reputation_connected_card&offerId=/);assert.match(chat,/<ConnectedReputationCard/);
 assert.match(hook,/reputationPostId:/);assert.match(ui,/VITE_KYRUB_FREELANCE_REPUTATION_DIRECT_FORWARD_TEST_ONLY/);
});

test('chat card preserves all four original indicators and identifies the original author',()=>{
 const ui=read('src/components/ReputationSquarePreview.tsx');
 const renderer=ui.slice(ui.indexOf('export function ReputationPublicationIndicators'),ui.indexOf('export function ReputationSquarePreview'));
 for(const field of ['completedServices','completedHires','reputations.professional','reputations.personalRequester'])assert.ok(renderer.includes(field),field);
 const chat=ui.slice(ui.indexOf('export function ConnectedReputationCard'));
 assert.match(chat,/<ReputationPublicationIndicators summary=\{summary\}/);
 assert.match(chat,/summary.publication.authorName/);
 assert.match(chat,/Autor original/);
 assert.match(chat,/Math.min\(60_000,/);
 assert.match(chat,/validConnectedReputationCard/);
});

test('cocar header uses publication snapshot and keeps the full reputation card',()=>{
 const ui=read('src/components/ReputationSquarePreview.tsx'),feed=read('src/components/PublicSocialFeedPanel.tsx');
 assert.match(ui,/formatCocarCompact\(count\)/);
 assert.match(ui,/Cocares na data da publicação/);
 assert.match(ui,/PublicationCocarLabel count=\{summary.publication.cocaresAtPublication\}/);
 assert.match(feed,/PublicationCocarLabel count=\{summary.cocaresAtPublication\}/);
 assert.match(ui,/VITE_KYRUB_FREELANCE_REPUTATION_COCAR_HEADER_TEST_ONLY/);
});
