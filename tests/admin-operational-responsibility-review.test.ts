import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const serviceSource = await readFile(new URL('../server/admin/operationalResponsibilityRouter.ts', import.meta.url), 'utf8');
const healthSource = await readFile(new URL('../server/admin/operationsHealthRouter.ts', import.meta.url), 'utf8');
const workspaceSource = await readFile(new URL('../src/components/admin/AdminOperationalResponsibilityWorkspace.tsx', import.meta.url), 'utf8');
const modulesSource = await readFile(new URL('../src/components/admin/AdminModulesWorkspace.tsx', import.meta.url), 'utf8');
const clientSource = await readFile(new URL('../src/utils/adminOperationalResponsibility.ts', import.meta.url), 'utf8');

test('admin review queue reads only responsibility assessments requiring human attention', () => {
  assert.match(serviceSource, /responsibilityAssessment\.status/);
  assert.match(serviceSource, /review_required/);
  assert.match(serviceSource, /external/);
  assert.match(serviceSource, /limit\(REVIEW_LIMIT\)/);
  assert.doesNotMatch(serviceSource, /transaction\.update|transaction\.set|\.update\(|\.set\(/);
});

test('review transport reuses server-side admin authorization and audits access', () => {
  assert.match(healthSource, /operational-responsibility-review/);
  assert.match(healthSource, /authorizeOperationsHealth/);
  assert.match(healthSource, /admin\.operational_responsibility\.review_queue_viewed/);
  assert.match(healthSource, /Cache-Control/);
});

test('client and workspace expose responsibility review as read-only', () => {
  assert.match(clientSource, /transport=operational-responsibility-review/);
  assert.match(workspaceSource, /Fila de revisão humana/);
  assert.match(workspaceSource, /somente leitura/i);
  assert.match(workspaceSource, /não altera obrigação, pagamento, reputação ou saldo/i);
  assert.doesNotMatch(workspaceSource, /Aprovar|Rejeitar|Cobrar|Punir/);
});

test('admin central exposes operational responsibility to super admin and operations', () => {
  assert.match(modulesSource, /profile\.role === 'super_admin' \|\| profile\.role === 'operations'/);
  assert.match(modulesSource, /Responsabilidade Operacional/);
  assert.match(modulesSource, /AdminOperationalResponsibilityWorkspace/);
});
