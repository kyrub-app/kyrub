import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('finance history fences obsolete requests and preserve manual reconciliation precedence',()=>{
  const history=readFileSync('src/components/store/StoreFinanceHistoryWorkspace.tsx','utf8');
  assert.match(history,/if\(append&&\(!cursor\|\|pageRequest\.current\)\)return/);
  assert.match(history,/pageRequest\.current===controller&&!controller\.signal\.aborted&&auth\.currentUser===user/);
  assert.match(history,/new Map\(\[\.\.\.previous,\.\.\.nextItems\]\.map\(item=>\[item\.id,item\]\)\)/);
  assert.match(history,/reconciliationRequestedRef\.current\.has\(item\.paymentId\)/);
  assert.match(history,/reconciliationReads\.current\.get\(paymentId\)\?\.abort\(\)/);
  assert.match(history,/if\(!context\|\|!user\|\|manualPending\.current\)return/);
  assert.match(history,/payload\.reconciliation\.paymentId!==input\.paymentId/);
});


test('period and history recovery share only in-flight work and do not overwrite canonical entries',()=>{
  const source=readFileSync('server/payments/storeFinanceHistoryRouter.ts','utf8');
  const recovery=source.slice(source.indexOf('const recoverAllMissingCanonicalPaidCaptures'),source.indexOf('type HistoryItem ='));
  assert.match(recovery,/adminDb\.runTransaction\(async transaction =>/);
  assert.match(recovery,/await transaction\.getAll\(\.\.\.refs\)/);
  assert.match(recovery,/if \(existing\[index\]\?\.exists\) return;\s*transaction\.create/);
  assert.doesNotMatch(recovery,/\bbatch\.set\(|\btransaction\.set\(/);
  assert.match(recovery,/activeCaptureRecoveries\.get\(storeId\)/);
  assert.match(recovery,/if \(existing\) return existing/);
  assert.match(recovery,/\.finally\(\(\) => \{\s*if \(activeCaptureRecoveries\.get\(storeId\) === pending\) activeCaptureRecoveries\.delete\(storeId\)/);
  const route=source.slice(source.indexOf("router.get('/',"));
  assert.equal((route.match(/await recoverCanonicalPaidCaptures\(storeId\)/g)??[]).length,2);
  assert.ok(route.indexOf('await requireOwner')<route.indexOf('await recoverCanonicalPaidCaptures'));
  assert.ok(route.indexOf('decodeCursor(request.query.cursor)')<route.lastIndexOf('await recoverCanonicalPaidCaptures'));
  assert.match(source,/complete: true/);
});
