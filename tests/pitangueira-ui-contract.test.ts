import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file: string) => readFileSync(file, 'utf8');

test('Semear replaces the legacy like only behind BOTH deployment guards', () => {
  const button = read('src/components/SemearButton.tsx');
  const handler = read('server/gamification/semeaduraHandler.ts');
  assert.match(button, /import\.meta\.env\?\.VITE_SEMEADURA_UI_ENABLED === 'true'/);
  assert.match(handler, /process\.env\.KYRUB_SEMEADURA_SERVER_ENABLED !== 'true'/);
  assert.match(handler, /SEMEADURA_NOT_ENABLED/);
  assert.match(button, /requestSemeadura\('status', \{ kind, postId \}/);
  assert.match(button, /requestSemeadura\('semear', \{ kind, postId \}/);
  assert.match(button, /!state\.canSemear/);
  assert.match(button, /state\?\.closed/);
  assert.match(button, /kyrub-semeadura-updated/);
  assert.doesNotMatch(button, /setDoc\(|addDoc\(|runTransaction\(/);
});

test('community Semear is a single reused card in Mural and Praça', () => {
  const card = read('src/components/CommunityPostCard.tsx');
  const square = read('src/components/CommunitySquareFeedCard.tsx');
  const mural = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  assert.match(card, /SEMEADURA_UI_ENABLED \? \(\s*<SemearButton kind="community" postId=\{post\.id\} viewerId=\{viewerId\} compact/);
  assert.match(square, /<CommunityPostCard/);
  assert.match(mural, /<CommunityPostCard/);
  assert.match(card, /onToggleLike\(isLiked\)/);
  assert.match(card, /Curtir/); // legacy mode stays available for rollback
});

test('Praça and personal profile Semear refer to the SAME canonical personal post', () => {
  const square = read('src/components/PublicSocialFeedPanel.tsx');
  const profile = read('src/components/ProfilePostInteractionsBridge.tsx');
  assert.match(square, /SEMEADURA_UI_ENABLED && post\.visibility === 'public' && post\.publicationType !== 'status'/);
  assert.match(square, /<SemearButton kind="personal" postId=\{post\.id\} viewerId=\{currentUserId\}/);
  assert.match(profile, /SEMEADURA_UI_ENABLED && item\.post\.visibility === 'public' && item\.post\.publicationType !== 'status'/);
  assert.match(profile, /<SemearButton kind="personal" postId=\{item\.post\.id\}/);
  assert.match(square, /onToggleLike\(post\.id\)/);
  assert.match(profile, /socialFeed\.toggleLike\(item\.post\.id\)/);
});

test('Pitangueira remains personal and separated from community pages and economic balances', () => {
  const account = read('src/components/tabs/PitangaAccount.tsx');
  const community = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  const panel = read('src/components/SemeaduraJourneyPanel.tsx');
  const rules = read('firestore.rules');
  assert.match(account, /<SemeaduraJourneyPanel/);
  assert.match(account, /viewerId=\{auth\.currentUser\?\.uid \|\| ''\}/);
  assert.match(account, /xp=\{mode === 'xp' \? \(account\?\.xp \?\? null\) : undefined\}/);
  assert.match(panel, /function CocarXpIcon\(\)/);
  assert.match(panel, /const showCanonicalXp = xp !== undefined/);
  assert.match(panel, /showCanonicalXp && \(/);
  assert.match(panel, /Cocar · XP/);
  assert.match(panel, /aria-label="Cocar, XP da conta de recompensas"/);
  assert.match(panel, /xp\.toLocaleString\('pt-BR'\)/);
  assert.doesNotMatch(community, /SemeaduraJourneyPanel|community-journey/);
  assert.doesNotMatch(panel, /communityId|community-journey|Jornada coletiva/);
  assert.match(panel, /Pitangas equivalentes/);
  assert.match(panel, /créditos efetivamente registrados/);
  // All new server-only counter/receipt paths remain inaccessible to clients.
  assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  assert.doesNotMatch(rules, /match \/semeadura_post_stats\//);
  assert.doesNotMatch(rules, /match \/semeaduraProgress\//);
});

test('Semeadura remains irrevocable and excludes community reward accumulation',()=>{
 const service=read('server/gamification/semeaduraService.ts');
 const handler=read('server/gamification/semeaduraHandler.ts');
 const button=read('src/components/SemearButton.tsx');
 assert.doesNotMatch(service,/communityProgressRef|readCommunitySemeaduraJourney|communities\/.*semeaduraProgress/);
 assert.doesNotMatch(handler,/community-journey|readCommunitySemeaduraJourney/);
 const authority=read('server/gamification/semeaduraRequestAuthority.ts');
 assert.match(authority,/body\.action!=='status'&&body\.action!=='semear'/);
 assert.match(handler,/parseSemeaduraRequest\(request\.body\)/);
 assert.match(handler,/authorizeSemeaduraMutation\(token/);
 assert.doesNotMatch(service,/tx\.delete\(receiptRef/);
 assert.match(button,/state\.seeded \|\| busy/);
 assert.match(button,/seeded:true,canSemear:false/);
 assert.match(button,/Semear é definitivo e não pode ser desfeito/);
});


test('gamification supervision scaffold stays local and super-admin only with isolated optional transport',()=>{
 const app=read('src/components/admin/AdminControlPlaneApp.tsx');
 const panel=read('src/components/admin/AdminGamificationSupervisionWorkspace.tsx');
 assert.match(app,/localGamificationSupervision = import\.meta\.env\.DEV && import\.meta\.env\.VITE_GAMIFICATION_SUPERVISION_PROTOTYPE === 'true'/);
 assert.match(app,/\['localhost','127\.0\.0\.1','admin\.localhost'\]\.includes\(window\.location\.hostname\)/);
 assert.match(app,/profile\.role === 'super_admin' && <AdminAccordionSection id="admin-global-challenges"/);
 assert.match(app,/localGamificationSupervision && profile\.uid === user\.uid && <AdminWorkspaceRecoveryBoundary/);
 assert.match(app,/<GlobalChallenges key=\{user\.uid\} user=\{user\} profile=\{profile\}/);
 assert.match(panel,/Nenhum dado real consultado/);
 assert.match(panel,/Indisponível/);
 assert.match(panel,/Pitangas utilizadas/);
 assert.match(panel,/Jornada Pitangueira/);
 assert.match(panel,/Revisões econômicas/);
 assert.match(panel,/id:'suspeitas', label:'Suspeitas de fraude'/);
 assert.match(panel,/Nenhum indício gera punição ou bloqueio automático/);
 assert.match(panel,/Não há detector de fraude conectado/);
 assert.match(panel,/id:'revisao', label:'Revisões econômicas'/);
 assert.doesNotMatch(panel,/from ['"].*firebase|fetch\(|axios|setDoc\(|runTransaction\(|localStorage|sessionStorage/);
});


test('gamification read panel is opt-in, same-origin, session-bound and never exposes mutations',()=>{
 const app=read('src/components/admin/AdminControlPlaneApp.tsx');
 const panel=read('src/components/admin/AdminGamificationPilotReadPanel.tsx');
 const client=read('src/utils/gamificationAdminPilotClient.ts');
 assert.match(app,/VITE_GAMIFICATION_SUPERVISION_HTTP_PILOT === 'true'/);
 assert.match(app,/auth\.app\.options\.projectId==='demo-kyrub-welcome'/);
 assert.match(app,/auth\.emulatorConfig\?\.host==='127\.0\.0\.1'/);
 assert.match(app,/auth\.currentUser===user/);
 assert.match(client,/fetch\('\/api\/admin\/gamification-pilot\?/);
 assert.match(client,/method:'GET'/);
 assert.match(client,/cache:'no-store',credentials:'omit',redirect:'error'/);
 assert.match(client,/!isCurrent\(\)\|\|signal\.aborted/);
 assert.match(panel,/controller\.abort\(\)/);
 assert.match(panel,/Cobertura global não verificada/);
 assert.match(panel,/Créditos brutos/);
 assert.match(panel,/Bosques pessoais/);
 assert.match(panel,/Nenhum caso nesta página/);
 assert.doesNotMatch(panel,/localStorage|sessionStorage|setDoc\(|runTransaction\(/);
});
