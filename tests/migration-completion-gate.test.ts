import assert from 'node:assert/strict';
import test from 'node:test';
import type { CanonicalReadConfig } from '../src/utils/canonicalReadCutover';
import type {
  MigrationReconciliationReport,
  MigrationReconciliationSection,
} from '../src/utils/migrationReconciliation';
import {
  DEFAULT_MIGRATION_COMPLETION_GATE,
  allMigrationCompletionChecksDone,
  buildReconciliationReadinessSignature,
  getMigrationCompletionPrerequisiteError,
  getMigrationCompletionReadiness,
  parseMigrationCompletionGate,
  type MigrationCompletionGateState,
} from '../src/utils/migrationCompletionGate';

const section = (
  key: MigrationReconciliationSection['key'],
  status: MigrationReconciliationSection['status'] = 'matched'
): MigrationReconciliationSection => ({
  key,
  title: key,
  status,
  coverage: '',
  metrics: [],
  issues:
    status === 'divergent'
      ? [{ entityId: `${key}-1`, message: 'Registro divergente.' }]
      : [],
});

const report = (
  overrides: Partial<MigrationReconciliationReport> = {}
): MigrationReconciliationReport => ({
  store: {
    id: 'store-canonical-1',
    ownerId: 'owner-1',
    name: 'Loja Teste',
    publicationStatus: 'published',
    plan: 'business',
    legacyTenantId: 'owner-1',
    migrationStatus: 'dual_write',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  },
  legacyStoreId: 'owner-1',
  checkedAt: '2026-07-22T20:00:00.000Z',
  readyForCanonicalRead: true,
  matchedSections: 4,
  divergentSections: 0,
  unavailableSections: 0,
  sections: [
    section('orders'),
    section('payments'),
    section('products'),
    section('cash'),
  ],
  ...overrides,
});

const readConfig: CanonicalReadConfig = {
  canonicalStoreId: 'store-canonical-1',
  preferences: {
    products: true,
    orders: true,
    payments: true,
  },
};

const completedGate = (): MigrationCompletionGateState => ({
  ...DEFAULT_MIGRATION_COMPLETION_GATE,
  canonicalStoreId: 'store-canonical-1',
  checklist: {
    products_flow: true,
    orders_flow: true,
    payments_flow: true,
    cash_flow: true,
    fallback_flow: true,
    reconciliation_after_tests: true,
  },
});

test('parseMigrationCompletionGate defaults missing data safely', () => {
  assert.deepEqual(
    parseMigrationCompletionGate(undefined),
    DEFAULT_MIGRATION_COMPLETION_GATE
  );
});

test('allMigrationCompletionChecksDone requires every real-flow confirmation', () => {
  assert.equal(
    allMigrationCompletionChecksDone(DEFAULT_MIGRATION_COMPLETION_GATE.checklist),
    false
  );
  assert.equal(allMigrationCompletionChecksDone(completedGate().checklist), true);
});

test('readiness requires aligned reconciliation, canonical reads and checklist', () => {
  const pending = getMigrationCompletionReadiness(
    report(),
    {
      canonicalStoreId: 'store-canonical-1',
      preferences: { products: true, orders: false, payments: true },
    },
    completedGate()
  );

  assert.equal(pending.ready, false);
  assert.match(pending.blockers.join(' '), /pedidos/);

  const ready = getMigrationCompletionReadiness(
    report(),
    readConfig,
    completedGate()
  );
  assert.equal(ready.ready, true);
  assert.equal(ready.confirmed, false);
});

test('owner confirmation is current only for the same reconciliation signature', () => {
  const currentReport = report();
  const signature = buildReconciliationReadinessSignature(currentReport);
  const gate: MigrationCompletionGateState = {
    ...completedGate(),
    confirmedByUserId: 'owner-1',
    confirmedAt: '2026-07-22T20:05:00.000Z',
    confirmedReconciliationSignature: signature,
  };

  assert.equal(
    getMigrationCompletionReadiness(currentReport, readConfig, gate).confirmed,
    true
  );

  const divergentReport = report({
    readyForCanonicalRead: false,
    matchedSections: 3,
    divergentSections: 1,
    sections: [
      section('orders', 'divergent'),
      section('payments'),
      section('products'),
      section('cash'),
    ],
  });
  const result = getMigrationCompletionReadiness(
    divergentReport,
    readConfig,
    gate
  );
  assert.equal(result.ready, false);
  assert.equal(result.confirmed, false);
});

test('check prerequisites enforce domain activation and final reconciliation', () => {
  assert.match(
    getMigrationCompletionPrerequisiteError(
      'products_flow',
      report(),
      {
        canonicalStoreId: 'store-canonical-1',
        preferences: { products: false, orders: true, payments: true },
      }
    ),
    /Ative a leitura canônica de produtos/
  );

  assert.match(
    getMigrationCompletionPrerequisiteError(
      'reconciliation_after_tests',
      report({
        readyForCanonicalRead: false,
        divergentSections: 1,
        matchedSections: 3,
      }),
      readConfig
    ),
    /Execute novamente a conferência/
  );

  assert.equal(
    getMigrationCompletionPrerequisiteError(
      'fallback_flow',
      report(),
      readConfig
    ),
    ''
  );
});
