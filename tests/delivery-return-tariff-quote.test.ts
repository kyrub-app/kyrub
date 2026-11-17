import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { quoteDeliveryReturnTariffs } from '../shared/deliveryReturnTariffQuote';

const terms={
  schemaVersion:1,policyId:'pilot_terms_v1',version:1,
  deliveryId:'d_1',courierId:'c_1',acceptedVia:'server_courier_claim',
  acceptedAt:'2026-11-17T09:00:00.000Z',currency:'BRL',
  returnRateMinorPerKm:150,returnMinimumMinor:400,
  recipientGraceMinutes:10,waitingIncrementMinutes:5,
  waitingRateMinorPerIncrement:100,waitingMaxMinor:500,
  waitingOperationalLimitMinutes:40,
};
const distance={source:'independent_route_plan',approved:true,routePlanId:'route_1',distanceMeters:4000};
const wait={source:'corroborated_server_interval',verified:true,
  arrivedAt:'2026-11-17T09:45:00.000Z',returnAuthorizedAt:'2026-11-17T10:01:00.000Z'};
const base={deliveryId:'d_1',courierId:'c_1',acceptedTerms:terms,
  returnAuthorizationAt:'2026-11-17T10:01:00.000Z',
  returnDistanceAuthority:distance,recipientWaitingAuthority:wait};

test('contracted return and recipient waiting are quoted in integer cents without creating payable',()=>{
  const q=quoteDeliveryReturnTariffs(base);
  assert.equal(q.returnMinor,600);
  assert.equal(q.recipientWaitingMinor,200);
  assert.equal(q.contractGraceMinutes,10);
  assert.equal(q.returnStatus,'quoted_pending_review');
  assert.equal(q.waitingStatus,'quoted_pending_review');
  assert.equal(q.payableTotalMinor,null);
  assert.equal(q.mayExecuteFinancially,false);
  assert.equal(quoteDeliveryReturnTariffs({...base,returnDistanceAuthority:{...distance,distanceMeters:1000}}).returnMinor,400);
  assert.equal(quoteDeliveryReturnTariffs({...base,returnDistanceAuthority:{...distance,distanceMeters:1001}}).returnMinor,400);
  assert.equal(quoteDeliveryReturnTariffs({...base,returnAuthorizationAt:'2026-11-17T09:50:00.000Z',recipientWaitingAuthority:{...wait,
    returnAuthorizedAt:'2026-11-17T09:50:00.000Z'}}).recipientWaitingMinor,0);
  assert.equal(quoteDeliveryReturnTariffs({...base,returnAuthorizationAt:'2026-11-17T10:30:00.000Z',recipientWaitingAuthority:{...wait,
    returnAuthorizedAt:'2026-11-17T10:30:00.000Z'}}).recipientWaitingMinor,null);
});

test('missing acceptance, mismatched courier or unverified route/clock are not authority',()=>{
  for(const t of [null,{...terms,courierId:'other'},{...terms,acceptedVia:'manual_admin'},
    {...terms,returnRateMinorPerKm:-1},{...terms,acceptedAt:'not-a-date'}]){
    const q=quoteDeliveryReturnTariffs({...base,acceptedTerms:t});
    assert.equal(q.returnMinor,null);
    assert.equal(q.recipientWaitingMinor,null);
    assert.equal(q.returnStatus,'contract_unavailable');
  }
  const retroactive=quoteDeliveryReturnTariffs({...base,
    acceptedTerms:{...terms,acceptedAt:'2026-11-17T10:02:00.000Z'}});
  assert.equal(retroactive.returnMinor,null);
  assert.equal(retroactive.recipientWaitingMinor,null);
  const mismatchedInterval=quoteDeliveryReturnTariffs({...base,
    recipientWaitingAuthority:{...wait,returnAuthorizedAt:'2026-11-17T10:02:00.000Z'}});
  assert.equal(mismatchedInterval.recipientWaitingMinor,null);
  const badRoute=quoteDeliveryReturnTariffs({...base,returnDistanceAuthority:{
    ...distance,source:'courier_self_reported'}});
  assert.equal(badRoute.returnMinor,null);
  assert.equal(badRoute.recipientWaitingMinor,200);
  const badClock=quoteDeliveryReturnTariffs({...base,recipientWaitingAuthority:{
    ...wait,verified:false}});
  assert.equal(badClock.recipientWaitingMinor,null);
  assert.equal(badClock.returnMinor,600);
  assert.throws(()=>quoteDeliveryReturnTariffs({...base,deliveryId:'a/b'}));
});

test('preflight uses only server-owned claim, route and corroborated interval sources',()=>{
  const service=readFileSync('server/delivery/deliveryReturnEconomicReviewService.ts','utf8');
  const model=readFileSync('shared/deliveryReturnEconomicPolicy.ts','utf8');
  const ui=readFileSync('src/components/admin/AdminDeliveryReturnEconomicsPreview.tsx','utf8');
  assert.match(service,/quoteDeliveryReturnTariffs/);
  assert.match(service,/claim\.returnTariffAcceptedTerms/);
  assert.match(service,/protocol\.independentReturnDistanceAuthority/);
  assert.match(service,/protocol\.recipientWaitingCorroboratedInterval/);
  assert.match(model,/quoted_pending_independent_review/);
  assert.match(ui,/Contrato aceito/);
  assert.doesNotMatch(service,/\.create\(|\.update\(|\.set\(/);
});
