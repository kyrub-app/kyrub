import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

describe('admin platform economy store scope', () => {
  test('server scopes economic ledger through the canonical store path', () => {
    const service = readFileSync('server/admin/platformEconomyService.ts', 'utf8');
    assert.match(service, /adminDb\.collection\(`stores\/\$\{storeId\}\/economicLedger`\)/);
    assert.match(service, /adminDb\.collectionGroup\('economicLedger'\)/);
    assert.match(service, /storeId\.includes\('\/'\)/);
    assert.doesNotMatch(service, /collectionGroup\('economicLedger'\)\.where\('storeId'/);
  });

  test('AI metering remains platform-wide when a store is selected', () => {
    const service = readFileSync('server/admin/platformEconomyService.ts', 'utf8');
    assert.match(service, /AI usage currently has no canonical store attribution/);
    assert.match(service, /collection\('kyrub_usage_events'\)\.where\('resource', '==', 'ai'\)/);
    assert.doesNotMatch(service, /aiUsageRoot\.where\('storeId'/);
  });

  test('route validates and forwards optional store scope', () => {
    const router = readFileSync('server/admin/platformEconomyRouter.ts', 'utf8');
    assert.match(router, /parseStoreId/);
    assert.match(router, /request\.query\.storeId/);
    assert.match(router, /STORE_SCOPE_INVALID/);
    assert.match(router, /targetType: storeId \? 'store' : 'control_plane'/);
  });

  test('browser sends store scope only when selected', () => {
    const client = readFileSync('src/utils/adminPlatformEconomy.ts', 'utf8');
    assert.match(client, /storeId = ''/);
    assert.match(client, /query\.set\('storeId', normalizedStoreId\)/);
    assert.match(client, /loadAdminPlatformEconomy/);
  });

  test('workspace can select and clear a store without attributing AI cost to it', () => {
    const workspace = readFileSync('src/components/admin/AdminPlatformEconomyWorkspace.tsx', 'utf8');
    assert.match(workspace, /const \[storeId, setStoreId\] = useState\(''\)/);
    assert.match(workspace, /loadAdminPlatformEconomy\(user, period, storeId\)/);
    assert.match(workspace, /onClick=\{\(\) => setStoreId\(store\.storeId\)\}/);
    assert.match(workspace, /Todas as lojas/);
    assert.match(workspace, /metering de IA ainda não possui atribuição canônica por loja/);
  });
});
