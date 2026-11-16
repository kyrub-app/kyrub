import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { DeliveryJob } from '../src/types';
import { isAvailableCourierOffer, isAssignedCourierDelivery, isCanonicalCourierDelivery } from '../src/utils/courierDeliveryView';

const job = (overrides: Partial<DeliveryJob> & { source?: string } = {}): DeliveryJob => ({
  id: 'order-test', from: 'Loja Teste', to: 'Rua de Teste', distance: 2,
  payment: 12, status: 'available', requestedBy: 'store-1',
  source: 'kyrub-order', ...overrides,
} as DeliveryJob);

test('only published ERP delivery opportunities can be accepted', () => {
  assert.equal(isCanonicalCourierDelivery(job()), true);
  assert.equal(isAvailableCourierOffer(job()), true);
  assert.equal(isAvailableCourierOffer(job({ source: 'manual' })), false);
  assert.equal(isAvailableCourierOffer(job({ source: undefined })), false);
  assert.equal(isAvailableCourierOffer(job({ status: 'accepted' })), false);
});

test('courier assignment is tied to authenticated UID, not public name', () => {
  for (const status of ['accepted', 'delivering', 'done'] as const) {
    assert.equal(isAssignedCourierDelivery(job({ status, acceptedBy: 'courier-1' }), 'courier-1'), true);
  }
  assert.equal(isAssignedCourierDelivery(job({ status: 'accepted', acceptedBy: 'Nome Público' }), 'courier-1'), false);
  assert.equal(isAssignedCourierDelivery(job({ status: 'accepted', acceptedBy: 'courier-1', source: 'manual' }), 'courier-1'), false);
  assert.equal(isAssignedCourierDelivery(job({ status: 'accepted', acceptedBy: 'courier-1' }), undefined), false);
});

test('real acceptance is an atomic server action, never a local optimistic claim', () => {
  const modal = readFileSync('src/components/modals/DeliveryManagerModal.tsx', 'utf8');
  const bridge = readFileSync('src/components/store/KyrubDeliveryOpportunityBridge.tsx', 'utf8');
  const renda = readFileSync('src/components/tabs/RendaTab.tsx', 'utf8');
  const router = readFileSync('server/delivery/deliveryOpportunityRouter.ts', 'utf8');
  assert.match(modal, /await updateKyrubDeliveryOpportunityStatus\(job\.id, 'accepted', user\)/);
  assert.match(modal, /deliveries\.filter\(isAvailableCourierOffer\)/);
  assert.match(modal, /isAssignedCourierDelivery\(d, auth\.currentUser\?\.uid\)/);
  assert.match(modal, /disabled=\{acceptingDeliveryId !== null\}/);
  assert.doesNotMatch(modal, /status: 'accepted', acceptedBy: profileName/);
  assert.match(bridge, /acceptedBy: clean\(data\.acceptedBy\) \|\| undefined/);
  assert.match(bridge, /acceptedByName: clean\(data\.acceptedByName\)/);
  assert.match(renda, /isAvailableCourierOffer/);
  assert.match(router, /transaction\.create\(claimReference/);
  assert.match(modal, /não publica ofertas para entregadores/);
  assert.match(modal, /Rascunho local · não publicado/);
});

test('GPS restore waits for a confirmed authorized assignment and drops stale local coordinates', () => {
  const tracking = readFileSync('src/components/store/CourierLiveTrackingBridge.tsx', 'utf8');
  assert.match(tracking, /const \[assignedDeliveriesLoaded, setAssignedDeliveriesLoaded\] = useState\(false\)/);
  assert.match(tracking, /setAssignedDeliveriesLoaded\(true\)/);
  assert.match(tracking, /assignedDeliveriesLoaded &&[\s\S]*trackingDeliveryId &&[\s\S]*!trackingAuthorized/);
  assert.match(tracking, /if \(!trackingDeliveryId \|\| !trackingAuthorized\) return/);
  assert.match(tracking, /navigator\.geolocation\.watchPosition/);
  assert.match(tracking, /localStorage\.removeItem\('kyrub_courier_last_position'\)/);
  assert.doesNotMatch(tracking, /localStorage\.setItem\([^\n]*kyrub_courier_last_position/);
});

test('ERP delivery cannot be marked done locally without buyer confirmation', () => {
  const modal = readFileSync('src/components/modals/DeliveryManagerModal.tsx', 'utf8');
  assert.match(modal, /job && isCanonicalCourierDelivery\(job\)/);
  assert.match(modal, /a entrega só termina após confirmação do cliente/i);
  assert.match(modal, /Confirme a chegada no painel de rastreio/);
});
