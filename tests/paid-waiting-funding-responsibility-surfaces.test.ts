import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync('server.ts', 'utf8');
const router = readFileSync(
  'server/delivery/paidWaitingFundingResponsibilityRouter.ts',
  'utf8'
);
const platformEconomyService = readFileSync(
  'server/admin/platformEconomyService.ts',
  'utf8'
);
const storeCard = readFileSync(
  'src/components/store/StorePaidWaitingFundingResponsibilityCard.tsx',
  'utf8'
);
const adminCard = readFileSync(
  'src/components/admin/AdminPaidWaitingFundingResponsibilityCard.tsx',
  'utf8'
);
const retailerPanel = readFileSync('src/components/RetailerPanel.tsx', 'utf8');
const adminWorkspace = readFileSync(
  'src/components/admin/AdminPlatformEconomyWorkspace.tsx',
  'utf8'
);

test('paid waiting responsibility router is mounted independently from delivery work eligibility', () => {
  assert.match(server, /createPaidWaitingFundingResponsibilityRouter/);
  assert.match(server, /\/api\/paid-waiting-funding-responsibility/);
  const mount = server.slice(
    server.indexOf('"/api/paid-waiting-funding-responsibility"'),
    server.indexOf('"/api/admin/operations/health"')
  );
  assert.doesNotMatch(mount, /enforceDeliveryWorkEligibility/);
});

test('store responsibility identity is resolved from authenticated tenant canonical store', () => {
  assert.match(router, /adminAuth\.verifyIdToken\(token, true\)/);
  assert.match(router, /`tenants\/\$\{decoded\.uid\}`/);
  assert.match(router, /canonicalStoreId/);
  assert.match(router, /loadStorePaidWaitingFundingResponsibility\(canonicalStoreId\)/);
  const route = router.slice(
    router.indexOf("router.get('/store'"),
    router.indexOf("router.get('/kyrub'")
  );
  assert.doesNotMatch(route, /request\.query|request\.body|request\.params/);
});

test('Kyrub responsibility requires the existing finance admin authority', () => {
  assert.match(router, /authorizePlatformEconomy/);
  assert.match(router, /loadKyrubPaidWaitingFundingResponsibility/);
});

test('store cash surface shows responsibility without turning it into a cash movement', () => {
  assert.match(retailerPanel, /StorePaidWaitingFundingResponsibilityCard/);
  assert.match(storeCard, /Espera remunerada · responsabilidade da loja/);
  assert.match(storeCard, /não registra saída no caixa/);
  assert.match(storeCard, /settledObligationMinor/);
  assert.doesNotMatch(storeCard, /onClick=.*pagar|sacar|transferir|wallet|availableBalance/i);
});

test('admin platform surface keeps Kyrub waiting responsibility outside economic net', () => {
  assert.match(adminWorkspace, /AdminPaidWaitingFundingResponsibilityCard user=\{user\}/);
  assert.match(adminCard, /Responsabilidade Kyrub · espera remunerada/);
  assert.match(adminCard, /não entram no econômico líquido/);
  assert.match(adminCard, /settledObligationMinor/);
  assert.doesNotMatch(platformEconomyService, /paidWaiting|FundingResponsibility/);
});

test('responsibility surfaces expose no automatic money movement action', () => {
  const combined = `${router}\n${storeCard}\n${adminCard}`;
  assert.doesNotMatch(
    combined,
    /createPayout|initiateTransfer|transferInstruction|walletBalance|availableBalance|chargeInstruction|debitInstruction|application_fee_amount/i
  );
});
