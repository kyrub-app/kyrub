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


test('public seed and private journey requests remain bound to the initiating account',()=>{
 const button=read('src/components/SemearButton.tsx');
 const journey=read('src/components/SemeaduraJourneyPanel.tsx');
 assert.match(button,/const session=auth\.currentUser;/);
 assert.match(button,/auth\.currentUser!==session\|\|signal\?\.aborted/);
 assert.match(button,/expectedUid!==undefined&&session\.uid!==expectedUid/);
 assert.match(button,/const token = await session!\.getIdToken\(\);\s*requireCurrent\(\)/);
 assert.match(button,/const result=await response\.json\(\) as Record<string, unknown>;\s*requireCurrent\(\)/);
 assert.match(button,/credentials: 'omit',\s*redirect: 'error'/);
 assert.match(button,/requestSemeadura\('status', \{ kind, postId \}, signal, viewerId\)/);
 assert.match(button,/requestSemeadura\('semear', \{ kind, postId \}, undefined, viewerId\)/);
 assert.match(journey,/<ScopedSemeaduraJourneyPanel key=\{viewerId\}/);
 assert.match(journey,/controller\.signal,\s*viewerId,/);
 assert.match(journey,/total===null\?'…':journey\.pitangasEquivalent/);
});


test('concurrent read coalescing isolates session, aborts subscribers independently and retains no completed cache',async()=>{
 const {createSemeaduraReadCoalescer}=await import('../src/utils/semeaduraReadCoalescer.js');
 const pool=createSemeaduraReadCoalescer<number>();
 const session={},other={};
 let calls=0;
 const pending:Array<(value:number)=>void>=[];
 const load=(_signal:AbortSignal)=>{calls++;return new Promise<number>(resolve=>pending.push(resolve));};
 const a=new AbortController();
 const first=pool.read(session,'post',load,a.signal);
 const second=pool.read(session,'post',load);
 const third=pool.read(other,'post',load);
 await Promise.resolve();
 assert.equal(calls,2);
 const rejected=assert.rejects(first,/SEMEADURA_READ_ABORTED/);
 a.abort();await rejected;
 pending[0](1);pending[1](2);
 assert.equal(await second,1);assert.equal(await third,2);
 const fresh=pool.read(session,'post',load);
 await Promise.resolve();
 assert.equal(calls,3);
 pool.invalidate(session,'post');
 const newer=pool.read(session,'post',load);
 await Promise.resolve();
 assert.equal(calls,4);
 pending[2](3);pending[3](4);
 assert.equal(await fresh,3);assert.equal(await newer,4);
 const cancel=new AbortController();
 let underlying:AbortSignal|undefined;
 const last=pool.read(session,'post',signal=>{underlying=signal;return new Promise<number>(()=>{});},cancel.signal);
 await Promise.resolve();
 const stopped=assert.rejects(last,/SEMEADURA_READ_ABORTED/);
 cancel.abort();await stopped;
 assert.equal(underlying?.aborted,true);
});

test('accepted controlled seed returns committed allowance and does not trigger own redundant read',()=>{
 const button=read('src/components/SemearButton.tsx');
 const service=read('server/gamification/semeaduraService.ts');
 assert.match(service,/releaseControlled\?\{dailyDay:day,dailyRemaining:SEMEADURA_DAILY_LIMIT-used-1\}/);
 assert.match(button,/normalizeSemeadura\(\{\.\.\.result,seeded:true,canSemear:false\}\)/);
 assert.match(button,/detail\?\.source===source\.current/);
 assert.match(button,/sharedReads\.invalidate\(session,key\)/);
});


test('status batcher groups distinct requests and rejects missing or cross-session results',async()=>{
 const {createSemeaduraStatusBatcher}=await import('../src/utils/semeaduraStatusBatcher.js');
 const batch=createSemeaduraStatusBatcher(),session={},other={};
 const signal=new AbortController().signal;
 const calls:Array<Array<{kind:string;postId:string}>>=[];
 const load=async(targets:Array<{kind:string;postId:string}>)=>{
  calls.push(targets);
  return {results:targets.map(t=>({...t,status:{count:Number(t.postId.slice(1))}}))};
 };
 const all=await Promise.all(Array.from({length:11},(_,i)=>batch(session,{kind:'personal',postId:'p'+i},signal,load)));
 assert.deepEqual(all.map(x=>x.count),Array.from({length:11},(_,i)=>i));
 assert.deepEqual(calls.map(x=>x.length),[10,1]);
 calls.length=0;
 await Promise.all([batch(session,{kind:'personal',postId:'p1'},signal,load),
  batch(other,{kind:'personal',postId:'p2'},signal,load)]);
 assert.deepEqual(calls.map(x=>x.length),[1,1]);
 await assert.rejects(batch(session,{kind:'personal',postId:'p3'},signal,async()=>({results:[{kind:'personal',postId:'wrong',status:{count:7}}]})),/SEMEADURA_BATCH_INVALID/);
 await assert.rejects(batch(session,{kind:'personal',postId:'p4'},signal,async()=>({results:[{kind:'personal',postId:'p4',status:null}]})),/SEMEADURA_STATUS_UNAVAILABLE/);
});


test('public mutation uses mandatory economic admission, never the visual-only fixture adapters',()=>{
 const handler=read('server/gamification/semeaduraHandler.ts');
 const service=read('server/gamification/semeaduraService.ts');
 const settlement=read('server/gamification/semeaduraEconomicPilot.ts');
 assert.match(handler,/await seedEconomicallyAdmittedPost\(adminDb, target, adminAuth\)/);
 assert.doesNotMatch(handler,/seedVerifiedPost|seedReleaseControlledPost/);
 assert.match(service,/seedEconomicallyAdmittedPost=.*seedPostTransaction\(db,input,true,authorAuth,true\)/);
 assert.match(service,/zeroStartRequired:requireEconomicAdmission\|\|/);
 assert.match(settlement,/strictCurrencyAuthority&&state\.currencyAuthority!=='welcome'&&state\.currencyAuthority!=='zero-history'/);
});
