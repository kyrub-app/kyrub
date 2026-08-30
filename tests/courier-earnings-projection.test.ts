import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync(
  'server/delivery/courierEarningsProjectionService.ts',
  'utf8'
);
const router = readFileSync(
  'server/delivery/deliveryOpportunityRouter.ts',
  'utf8'
);
const card = readFileSync(
  'src/components/renda/CourierEarningsProjectionCard.tsx',
  'utf8'
);
const renda = readFileSync('src/components/tabs/RendaTab.tsx', 'utf8');

test('courier earnings are derived from payable projections scoped to authenticated beneficiary', () => {
  assert.match(service, /collectionGroup\('economicObligations'\)/);
  assert.match(service, /beneficiaryPrincipalId', '==', courierUserId/);
  assert.match(service, /obligation\.kind === 'courier_payable'/);
  assert.match(service, /derivePayableProjections/);
  assert.match(service, /projection\.beneficiaryPrincipalId !== courierUserId/);
});

test('projected eligible settled and reversed remain separate economic states', () => {
  assert.match(service, /projectedMinor/);
  assert.match(service, /eligibleMinor/);
  assert.match(service, /settledMinor/);
  assert.match(service, /reversedMinor/);
  assert.match(service, /projection\.state === 'projected'/);
  assert.match(service, /projection\.state === 'eligible'/);
  assert.match(service, /projection\.state === 'settled'/);
  assert.match(service, /projection\.state === 'reversed'/);
});

test('integrity errors are counted but excluded from monetary totals', () => {
  const integrityBranch = service.indexOf("projection.state === 'integrity_error'");
  const projectedBranch = service.indexOf("projection.state === 'projected'");
  assert.ok(integrityBranch >= 0);
  assert.ok(projectedBranch > integrityBranch);
  assert.match(service.slice(integrityBranch, projectedBranch), /integrityErrorCount \+= 1/);
  assert.match(service.slice(integrityBranch, projectedBranch), /continue/);
});

test('earnings projection is read-only and does not execute money movement', () => {
  assert.doesNotMatch(
    service,
    /transaction\.|\.set\(|\.create\(|\.update\(|\.delete\(|payout|transfer|wallet|custod/i
  );
});

test('earnings endpoint derives courier identity from auth instead of request input', () => {
  assert.match(router, /router\.get\('\/earnings'/);
  assert.match(router, /const courierId = await authenticatedTenantId\(request\)/);
  assert.match(router, /loadCourierEarningsProjection\(courierId\)/);
  const route = router.slice(router.indexOf("router.get('/earnings'"), router.indexOf("router.get('/:deliveryId/pickup-code'"));
  assert.doesNotMatch(route, /request\.query|request\.body|request\.params/);
});

test('Renda shows economic states without calling them balance or offering payout actions', () => {
  assert.match(renda, /CourierEarningsProjectionCard/);
  assert.match(card, /Ganhos em entregas/);
  assert.match(card, />Previsto</);
  assert.match(card, />Elegível</);
  assert.match(card, />Liquidado</);
  assert.match(card, />Revertido</);
  assert.match(card, /\/api\/delivery-opportunities\/earnings/);
  assert.doesNotMatch(card, /saldo disponível|sacar|saque|payout|transferir/i);
});
