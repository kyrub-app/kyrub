import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('local attendance start action keeps people count and start arrow on one compact row', () => {
  const workspace = readFileSync(
    'src/components/store/LocalAttendanceWorkspace.tsx',
    'utf8'
  );

  assert.match(workspace, />Pessoas</);
  assert.match(workspace, /aria-label="Quantidade de pessoas"/);
  assert.match(workspace, /aria-label="Iniciar atendimento"/);
  assert.match(workspace, /<ArrowRight className="h-5 w-5" \/>/);
  assert.match(workspace, /grid-cols-\[minmax\(0,1fr\)_4rem\]/);
  assert.doesNotMatch(workspace, />\s*Abrir\s*</);
});
