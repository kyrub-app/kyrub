import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  buildOpenLocalAttendance,
  localAttendancePath,
  normalizeLocalAttendanceItemCount,
  normalizeLocalAttendanceSpace,
  parseLocalAttendanceSession,
} from '../shared/localAttendance';

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
  });

  test('server derives store authority from Firebase identity and institutional ownership', () => {
    const router = readFileSync('server/attendance/localAttendanceRouter.ts', 'utf8');
    assert.match(router, /verifyFirebaseIdToken\(token\)/);
    assert.match(router, /loadOwnerStoreInstitutionalRepresentation/);
    assert.match(router, /actorUserId: representation\.authenticatedUserId/);
    assert.doesNotMatch(router, /request\.body\?\.actorUserId/);
  });

  test('browser client sends operational fields only and never writes Firestore/localStorage', () => {
    const client = readFileSync('src/utils/localAttendance.ts', 'utf8');
    assert.match(client, /\/api\/local-attendance/);
    assert.match(client, /currentUser\(\)\.getIdToken\(\)/);
    assert.doesNotMatch(client, /setDoc|addDoc|collection\(db|doc\(db/);
    assert.doesNotMatch(client, /localStorage/);
    assert.doesNotMatch(client, /actorUserId/);
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
    assert.match(bridge, /node\.style\.display = 'none'/);
  });

  test('workspace refreshes across devices and never claims payment or fiscal completion', () => {
    const workspace = readFileSync('src/components/store/LocalAttendanceWorkspace.tsx', 'utf8');
    assert.match(workspace, /setInterval\(\(\) => void refresh\(true\), 10000\)/);
    assert.match(workspace, /não confirma pagamento, fiscal ou pedido online/);
    assert.match(workspace, /closeLocalAttendance/);
    assert.doesNotMatch(workspace, /checkout|gateway|nota fiscal emitida|pagamento concluído/i);
  });

  test('direct browser Firestore access to attendance stays closed', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    assert.doesNotMatch(rules, /match \/localAttendance\//);
    assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  });
});
