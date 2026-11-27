import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import './delivery-paid-waiting.test';

describe('secure courier pickup handoff', () => {
  const service = readFileSync('server/delivery/deliveryPickupHandoffService.ts', 'utf8');
  const router = readFileSync('server/delivery/deliveryOpportunityRouter.ts', 'utf8');
  const eligibility = readFileSync('server/identity/workEligibilityMiddleware.ts', 'utf8');
  const courier = readFileSync('src/components/store/CourierLiveTrackingBridge.tsx', 'utf8');
  const store = readFileSync('src/components/store/StoreDeliveryTrackingBridge.tsx', 'utf8');
  const sync = readFileSync('src/components/store/KyrubDeliveryStatusSyncBridge.tsx', 'utf8');

  test('requires independent six-digit code, active tracking, geofence evidence and ready order', () => {
    assert.match(service, /deliveryPickupSecrets/);
    assert.match(service, /\^\\d\{6\}\$/);
    assert.match(service, /tracking\?\.active !== true/);
    assert.match(service, /courier_inside_store_geofence/);
    assert.match(service, /liveOrderStatus !== 'ready'/);
    assert.match(service, /timingSafeEqual/);
    assert.match(service, /DELIVERY_PICKUP_MAX_ATTEMPTS = 5/);
  });

  test('invalid attempts commit before the user-facing error and can lock at five', () => {
    const transactionEnd = service.indexOf('if (result.ok === false)');
    assert.match(service, /return \{ ok: false, nextAttempts, locked \}/);
    assert.match(service, /pickupHandoff\.status': 'locked'/);
    assert.ok(transactionEnd > service.indexOf('return { ok: false, nextAttempts, locked }'));
    assert.match(service.slice(transactionEnd), /Código incorreto/);
  });

  test('successful handoff starts route atomically and consumes the secret', () => {
    assert.match(service, /status: 'handed_over'/);
    assert.match(service, /status: 'delivering'/);
    assert.match(service, /pickupHandoff: handoff/);
    assert.match(service, /const collectedAt = Timestamp\.now\(\)/);
    assert.match(service, /paidWaitingEvidence/);
    assert.match(service, /transaction\.delete\(secretRef\)/);
  });

  test('generic status endpoint cannot bypass secure pickup for Kyrub orders', () => {
    assert.match(router, /clean\(delivery\.source\) === 'kyrub-order'/);
    assert.match(router, /Confirme a coleta segura antes de iniciar a rota/);
    assert.match(router, /:deliveryId\/secure-pickup/);
    assert.match(router, /:deliveryId\/pickup-code/);
    assert.match(eligibility, /status\|secure-pickup\|customer-arrival/);
    assert.match(eligibility, /return 'courier'/);
  });

  test('store owns code display and courier enters it only after geofence arrival', () => {
    assert.match(store, /Código de coleta do entregador/);
    assert.match(store, /pickup-code/);
    assert.match(store, /delivery\.status === 'accepted'/);
    assert.match(courier, /storeArrivalDetected/);
    assert.match(courier, /activeDelivery\.status === 'accepted'/);
    assert.match(courier, /Código de coleta/);
    assert.match(courier, /Confirmar coleta e iniciar rota/);
    assert.match(courier, /secure-pickup/);
  });

  test('background bridge cannot submit acceptance, route start or completion from cache', () => {
    assert.doesNotMatch(sync, /CLOUD_STATUSES|localStorage|sessionStorage|setInterval|updateKyrubDeliveryOpportunityStatus|confirmKyrubDeliveryAcceptance/);
    assert.doesNotMatch(sync, /\/status\b|\/accept\b|\/secure-pickup\b|\/buyer-confirmation\b/);
    assert.match(sync, /onSnapshot\(/);
    assert.match(sync, /clean\(data\.acceptedBy\) !== user\.uid/);
    assert.match(sync, /clean\(data\.status\) !== 'delivering'/);
    assert.match(sync, /onClick=\{\(\) => \{[\s\S]*?void notifyCustomerArrival\(activeDelivery\.id\)/);
    assert.match(sync, /\/customer-arrival/);
  });

  test('pickup handoff remains operational only and cannot complete delivery or settle money', () => {
    assert.doesNotMatch(service, /economicObligationPath|eligibleAt|economicSettlements|status:\s*'settled'|payout|transfer|wallet|custodial/i);
    assert.doesNotMatch(service, /status:\s*'done'|deliveredAt|buyerConfirmed/i);
  });
});
