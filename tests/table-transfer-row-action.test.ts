import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('table account keeps transfer next to item actions instead of an isolated top button', () => {
  const workspace = readFileSync('src/components/customer/LegacyTableServiceWorkspace.tsx', 'utf8');

  assert.match(workspace, /onTransfer\?: \(line: TableOpenLine\) => void/);
  assert.match(workspace, /aria-label=\{`Transferir \${line\.name} para outra mesa`\}/);
  assert.match(workspace, /setTransferSelections\(\{ \[line\.key\]: line\.availableQuantity \}\)/);
  assert.match(workspace, /setView\('transfer'\)/);
  assert.doesNotMatch(workspace, /mb-4 flex items-center justify-end[\s\S]{0,500}ArrowRightLeft[\s\S]{0,100}Transferir/);
});
