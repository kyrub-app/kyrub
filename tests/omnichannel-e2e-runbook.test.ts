import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './omnichannel-e2e-evidence-log.test.ts';

const runbookSource = readFileSync(
  'src/utils/omnichannelE2ERunbook.ts',
  'utf8'
);
const panelSource = readFileSync(
  'src/components/store/OmnichannelE2ERunbookPanel.tsx',
  'utf8'
);
const portalSource = readFileSync(
  'src/components/store/StoreConnectionsPortalBridge.tsx',
  'utf8'
);

test('omnichannel runbook covers preflight, both provider catalog paths, real 99Food order authority and closeout', () => {
  assert.match(runbookSource, /phase: 'preflight'/);
  assert.match(runbookSource, /phase: 'mercado_livre'/);
  assert.match(runbookSource, /phase: '99food_catalog'/);
  assert.match(runbookSource, /phase: '99food_order'/);
  assert.match(runbookSource, /phase: 'closeout'/);
  assert.match(runbookSource, /Criar um pedido real\/controlado do lado da 99Food/);
  assert.match(runbookSource, /Provar o ramo Kyrub-only sem provider write oculto/);
  assert.match(runbookSource, /Provar o ramo Kyrub \+ 99Food em uma transição seguinte/);
});

test('each real provider write is explicitly separated from owner authorization and reconciliation evidence', () => {
  assert.match(runbookSource, /'owner_authorization'/);
  assert.match(runbookSource, /'provider_write'/);
  assert.match(runbookSource, /'reconciliation'/);
  assert.match(runbookSource, /Autorização one-time criada pelo owner/);
  assert.match(runbookSource, /execute “Publicar agora” uma única vez/);
  assert.match(runbookSource, /execute o PATCH real uma única vez/);
  assert.match(runbookSource, /Provider write ocorre no máximo uma vez para aquela autorização/);
});

test('runbook explicitly proves 99Food Kyrub-only, immutable revision and no hidden retry semantics', () => {
  assert.match(runbookSource, /integration\.outboundStatus = authorization_required/);
  assert.match(runbookSource, /Nenhum sendAction\/provider write ocorre nessa decisão/);
  assert.match(runbookSource, /orderRevision atual/);
  assert.match(runbookSource, /executionId \+ orderRevision/);
  assert.match(runbookSource, /localTransitionApplied = false/);
  assert.match(runbookSource, /sem retry automático/);
});

test('runbook stops instead of inferring through missing authority, binding, ambiguous provider outcome or partial readiness', () => {
  assert.match(runbookSource, /Qualquer gate estrutural estiver bloqueado/);
  assert.match(runbookSource, /Alguma fonte estiver parcial sem explicação/);
  assert.match(runbookSource, /binding canônico estiver ausente ou divergente/);
  assert.match(runbookSource, /execução terminar ambígua sem reconciliação/);
  assert.match(runbookSource, /orderRevision mudar antes do claim/);
  assert.match(runbookSource, /reconciliation_required não tratado/);
});

test('runbook utility is declarative and contains no runtime mutation or network path', () => {
  assert.doesNotMatch(
    runbookSource,
    /\bfetch\(|axios|firebase|firestore|setDoc|updateDoc|sendAction\(|executeMercadoLivre|executeNinetyNineFood|retryNinetyNineFood|setInterval|setTimeout/i
  );
  assert.doesNotMatch(runbookSource, /onClick|useEffect|useState|window\./);
});

test('runbook panel only renders guidance and scroll navigation to existing benches', () => {
  assert.match(panelSource, /OMNICHANNEL_E2E_RUNBOOK_PHASES\.map/);
  assert.match(panelSource, /step\.expectedEvidence\.map/);
  assert.match(panelSource, /step\.stopIf\.map/);
  assert.match(panelSource, /scrollToBench/);
  assert.match(panelSource, /kyrub-mercado-livre-channel-detail/);
  assert.match(panelSource, /kyrub-99food-channel-detail/);
  assert.match(panelSource, /não executa etapas nem marca sucesso por clique/);
  assert.match(panelSource, /não guarda “check” de conclusão/);
  assert.doesNotMatch(
    panelSource,
    /\bfetch\(|authorize|executeMercadoLivre|executeNinetyNineFood|retryNinetyNineFood|sendNinetyNineFood|reconcileNinetyNineFood|localStorage|sessionStorage|setInterval|setTimeout/i
  );
});

test('portal places the passive runbook after readiness and before provider benches', () => {
  const readinessIndex = portalSource.indexOf('<OmnichannelE2EReadinessPanel');
  const runbookIndex = portalSource.indexOf('<OmnichannelE2ERunbookPanel');
  const mercadoLivreIndex = portalSource.indexOf('<MercadoLivreE2ETestBridge');
  const ninetyNineFoodIndex = portalSource.indexOf('<NinetyNineFoodE2ETestBridge');
  assert.match(portalSource, /import OmnichannelE2ERunbookPanel/);
  assert.ok(readinessIndex >= 0);
  assert.ok(runbookIndex > readinessIndex);
  assert.ok(mercadoLivreIndex > runbookIndex);
  assert.ok(ninetyNineFoodIndex > runbookIndex);
});
