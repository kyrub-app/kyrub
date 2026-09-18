import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import './in-person-order-creation.test';
import './in-person-customer-linking.test';
import './local-payment-intent-create.test';
import './local-payment-webhook-validation.test';
import {
  buildOpenLocalAttendance,
  localAttendancePath,
  normalizeLocalAttendanceItemCount,
  normalizeLocalAttendanceSpace,
  parseLocalAttendanceSession,
} from '../shared/localAttendance';
import {
  buildServiceLocation,
  buildUpdatedServiceLocation,
  inferLegacyServiceLocationKind,
  parseServiceLocation,
  serviceLocationPath,
} from '../shared/serviceLocation';

describe('canonical local attendance', () => {
  test('open attendance is store-scoped, audited and operational only', () => {
    const session = buildOpenLocalAttendance({
      id: 'attendance-1',
      storeId: 'store-1',
      customerLabel: ' Cliente balcão ',
      space: 'balcão',
      itemCount: 2,
      actorUserId: 'owner-1',
      openedAt: '2026-08-29T12:00:00.000Z',
    });
    assert.equal(session.customerLabel, 'Cliente balcão');
    assert.equal(session.space, 'BALCÃO');
    assert.equal(session.serviceLocation, null);
    assert.equal(session.itemCount, 2);
    assert.equal(session.status, 'open');
    assert.equal(session.storePrincipalId, 'store:store-1');
    assert.equal(session.openedByUserId, 'owner-1');
    assert.equal(session.closedAt, '');
  });

  test('contract bounds space, item count and tenant path', () => {
    assert.equal(normalizeLocalAttendanceSpace(' entrega '), 'ENTREGA');
    assert.equal(normalizeLocalAttendanceItemCount(1), 1);
    assert.throws(() => normalizeLocalAttendanceItemCount(0));
    assert.throws(() => normalizeLocalAttendanceItemCount(1000));
    assert.equal(
      localAttendancePath('store-1', 'attendance-1'),
      'stores/store-1/localAttendance/attendance-1'
    );
  });

  test('managed service location keeps stable identity while labels can evolve', () => {
    const created = buildServiceLocation({
      id: 'location-1',
      storeId: 'store-1',
      kind: 'table',
      label: 'Mesa 5',
      now: '2026-09-16T12:00:00.000Z',
    });
    const updated = buildUpdatedServiceLocation(created, {
      label: 'Mesa 05',
      kind: 'table',
      now: '2026-09-16T12:10:00.000Z',
    });
    assert.equal(updated.id, created.id);
    assert.equal(updated.storeId, created.storeId);
    assert.equal(updated.createdAt, created.createdAt);
    assert.equal(updated.label, 'Mesa 05');
    assert.equal(
      serviceLocationPath('store-1', 'location-1'),
      'stores/store-1/serviceLocations/location-1'
    );
    assert.deepEqual(
      parseServiceLocation(updated, 'store-1', 'location-1'),
      updated
    );
  });

  test('legacy promotion inference is conservative and excludes workflow/production labels', () => {
    assert.equal(inferLegacyServiceLocationKind('MESA 5'), 'table');
    assert.equal(inferLegacyServiceLocationKind('BALCÃO 2'), 'counter');
    assert.equal(inferLegacyServiceLocationKind('VAGA 3'), 'parking_spot');
    assert.equal(inferLegacyServiceLocationKind('QUARTO 203'), 'room');
    assert.equal(inferLegacyServiceLocationKind('GUICHÊ 4'), 'service_window');
    for (const label of ['GERAL', 'ENTREGA', 'AGENDADOS', 'COZINHA', 'CHAPA', 'FORNO']) {
      assert.equal(inferLegacyServiceLocationKind(label), null, label);
    }
  });

  test('canonical location is snapshotted into attendance while legacy space stays compatible', () => {
    const location = buildServiceLocation({
      id: 'counter-2',
      storeId: 'store-1',
      kind: 'counter',
      label: 'Balcão 2',
      now: '2026-09-16T12:00:00.000Z',
    });
    const session = buildOpenLocalAttendance({
      id: 'attendance-2',
      storeId: 'store-1',
      customerLabel: 'Cliente',
      serviceLocation: location,
      itemCount: 1,
      actorUserId: 'owner-1',
      openedAt: '2026-09-16T12:30:00.000Z',
    });
    assert.equal(session.space, 'BALCÃO 2');
    assert.deepEqual(session.serviceLocation, {
      schemaVersion: 1,
      id: 'counter-2',
      kind: 'counter',
      label: 'Balcão 2',
    });
    const renamed = buildUpdatedServiceLocation(location, {
      label: 'Balcão Principal',
      now: '2026-09-16T13:00:00.000Z',
    });
    assert.equal(renamed.label, 'Balcão Principal');
    assert.equal(session.serviceLocation?.label, 'Balcão 2');
  });

  test('closed records require close audit without changing the original opening audit', () => {
    const closed = parseLocalAttendanceSession({
      schemaVersion: 1,
      id: 'attendance-1',
      storeId: 'store-1',
      storePrincipalId: 'store:store-1',
      customerLabel: 'Cliente',
      space: 'BALCÃO',
      itemCount: 1,
      status: 'closed',
      openedAt: '2026-08-29T12:00:00.000Z',
      updatedAt: '2026-08-29T12:10:00.000Z',
      closedAt: '2026-08-29T12:10:00.000Z',
      openedByUserId: 'owner-1',
      closedByUserId: 'owner-2',
    }, 'store-1', 'attendance-1');
    assert.equal(closed.openedByUserId, 'owner-1');
    assert.equal(closed.closedByUserId, 'owner-2');
    assert.equal(closed.serviceLocation, null);
  });

  test('server derives store authority from Firebase identity and institutional ownership', () => {
    const router = readFileSync('server/attendance/localAttendanceRouter.ts', 'utf8');
    assert.match(router, /verifyFirebaseIdToken\(token\)/);
    assert.match(router, /loadOwnerStoreInstitutionalRepresentation/);
    assert.match(router, /actorUserId: representation\.authenticatedUserId/);
    assert.doesNotMatch(router, /request\.body\?\.actorUserId/);
  });

  test('service location writes reuse server authority and never trust a browser snapshot', () => {
    const router = readFileSync('server/attendance/localAttendanceRouter.ts', 'utf8');
    const service = readFileSync('server/attendance/serviceLocationService.ts', 'utf8');
    assert.match(router, /router\.post\('\/locations'/);
    assert.match(router, /router\.patch\('\/locations\/:locationId'/);
    assert.match(router, /requireStoreAuthority/);
    assert.match(router, /getServiceLocation\(\{/);
    assert.match(router, /serviceLocationId/);
    assert.doesNotMatch(router, /request\.body\?\.serviceLocation\b/);
    assert.match(service, /stores\/\$\{storeId\}\/serviceLocations/);
    assert.match(service, /adminDb\.runTransaction/);
    assert.doesNotMatch(service, /delete\(|\.delete\(/);
  });

  test('browser client sends operational fields only and never writes Firestore/localStorage', () => {
    const client = readFileSync('src/utils/localAttendance.ts', 'utf8');
    assert.match(client, /\/api\/local-attendance/);
    assert.match(client, /currentUser\(\)\.getIdToken\(\)/);
    assert.match(client, /serviceLocationId/);
    assert.doesNotMatch(client, /setDoc|addDoc|collection\(db|doc\(db/);
    assert.doesNotMatch(client, /localStorage/);
    assert.doesNotMatch(client, /actorUserId/);
  });

  test('service location browser client also stays behind authenticated server API', () => {
    const client = readFileSync('src/utils/serviceLocations.ts', 'utf8');
    assert.match(client, /currentUser\(\)\.getIdToken\(\)/);
    assert.match(client, /\/api\/local-attendance\/locations/);
    assert.doesNotMatch(client, /setDoc|addDoc|collection\(db|doc\(db/);
  });

  test('close is idempotent and only transitions the local attendance record', () => {
    const service = readFileSync('server/attendance/localAttendanceService.ts', 'utf8');
    const closeStart = service.indexOf('export const closeLocalAttendanceSession');
    const closeBlock = service.slice(closeStart);
    assert.match(closeBlock, /adminDb\.runTransaction/);
    assert.match(closeBlock, /if \(current\.status === 'closed'\) return current/);
    assert.match(closeBlock, /status: 'closed'/);
    assert.match(closeBlock, /closedByUserId: actorUserId/);
    assert.doesNotMatch(closeBlock, /payment|cash|fiscal|invoice|storePoint|kcoin/i);
  });

  test('local attendance remains separate from marketplace orders, CRM identity and delivery economy', () => {
    const shared = readFileSync('shared/localAttendance.ts', 'utf8');
    const service = readFileSync('server/attendance/localAttendanceService.ts', 'utf8');
    assert.doesNotMatch(shared, /orderId|paymentId|customerId|deliveryId|amount|price|kcoin/i);
    assert.doesNotMatch(service, /customerOrders|payments|delivery|storePointLedger|rewardRedemptions/i);
  });

  test('bridge replaces only legacy ticket UI and preserves CRM/table canonical hosts', () => {
    const bridge = readFileSync('src/components/store/LocalAttendanceBridge.tsx', 'utf8');
    const app = readFileSync('src/App.tsx', 'utf8');
    assert.match(app, /<LocalAttendanceBridge \/>/);
    assert.match(bridge, /erp-attendance-opener-row/);
    assert.match(bridge, /store-crm-relationship-host/);
    assert.match(bridge, /kyrub-customer-table-board-host/);
    assert.match(bridge, /canonical-local-attendance-host/);
    assert.match(bridge, /loadServiceLocations/);
    assert.match(bridge, /node\.style\.display = 'none'/);
  });

  test('managed environment UI preserves production spaces and does not auto-promote seed values', () => {
    const modal = readFileSync('src/components/modals/LegacyStoreConfigModal.tsx', 'utf8');
    const manager = readFileSync('src/components/store/ServiceLocationManager.tsx', 'utf8');
    assert.match(modal, /<ServiceLocationManager legacySpaces=\{atendimentoSpaces\} \/>/);
    assert.match(modal, /Espaços de Produção/);
    assert.match(manager, /isOnlyLegacySeed/);
    assert.match(manager, /A promoção é manual/);
    assert.match(manager, /Nenhum local de atendimento cadastrado/);
    assert.doesNotMatch(manager, /createManagedServiceLocation\([^)]*GERAL/);
  });

  test('workspace refreshes across devices and never claims payment or fiscal completion', () => {
    const workspace = readFileSync('src/components/store/LocalAttendanceWorkspace.tsx', 'utf8');
    assert.match(workspace, /setInterval\(\(\) => void refresh\(true\), 10000\)/);
    assert.match(workspace, /não confirma pagamento, fiscal ou pedido online/);
    assert.match(workspace, /closeLocalAttendance/);
    assert.match(workspace, /serviceLocationId: choice\.serviceLocationId/);
    assert.doesNotMatch(workspace, /\['GERAL'\]/);
    assert.doesNotMatch(workspace, /checkout|gateway|nota fiscal emitida|pagamento concluído/i);
  });

  test('direct browser Firestore access to attendance and service locations stays closed', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    assert.doesNotMatch(rules, /match \/localAttendance\//);
    assert.doesNotMatch(rules, /match \/serviceLocations\//);
    assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  });
});
