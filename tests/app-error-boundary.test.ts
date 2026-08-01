import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('the application root is protected by a recovery boundary', () => {
  const mainSource = readFileSync('src/main.tsx', 'utf8');
  const boundarySource = readFileSync(
    'src/components/AppErrorBoundary.tsx',
    'utf8'
  );

  assert.match(mainSource, /<AppErrorBoundary>/);
  assert.match(mainSource, /<App\s*\/>/);
  assert.match(mainSource, /if \(!rootElement\)/);
  assert.match(boundarySource, /static getDerivedStateFromError/);
  assert.match(boundarySource, /componentDidCatch/);
  assert.match(boundarySource, /kyrub:client-error/);
  assert.match(boundarySource, /Código do incidente/);
  assert.match(boundarySource, /Recarregar o Kyrub/);
  assert.match(boundarySource, /Voltar ao início/);
});

test('the recovery diagnostic avoids serializing application state', () => {
  const boundarySource = readFileSync(
    'src/components/AppErrorBoundary.tsx',
    'utf8'
  );

  assert.match(boundarySource, /name: error\.name/);
  assert.match(boundarySource, /message: error\.message/);
  assert.match(boundarySource, /componentStack: info\.componentStack/);
  assert.doesNotMatch(boundarySource, /localStorage/);
  assert.doesNotMatch(boundarySource, /sessionStorage/);
  assert.doesNotMatch(boundarySource, /auth\.currentUser/);
});
