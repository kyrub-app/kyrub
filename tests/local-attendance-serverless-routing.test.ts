import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('Vercel exposes canonical local attendance through the existing health multiplexer', () => {
  const vercel = readFileSync('vercel.json', 'utf8');
  const health = readFileSync('api/health.ts', 'utf8');
  const transport = readFileSync(
    'server/attendance/localAttendanceServerlessTransport.ts',
    'utf8'
  );

  assert.match(vercel, /"source": "\/api\/local-attendance"/);
  assert.match(
    vercel,
    /"destination": "\/api\/health\?transport=local-attendance"/
  );
  assert.match(vercel, /"source": "\/api\/local-attendance\/:path\*"/);
  assert.match(
    vercel,
    /"destination": "\/api\/health\?transport=local-attendance&path=:path\*"/
  );
  assert.match(health, /transport === 'local-attendance'/);
  assert.match(health, /localAttendanceServerlessTransport\.js/);
  assert.match(health, /handleLocalAttendanceServerlessRequest/);
  assert.equal(existsSync('api/local-attendance.ts'), false);
  assert.match(transport, /createLocalAttendanceRouter/);
  assert.match(
    transport,
    /app\.use\('\/api\/local-attendance', createLocalAttendanceRouter\(\)\)/
  );
  assert.match(
    transport,
    /request\.url = `\/api\/local-attendance\$\{path \? `\/\$\{path\}` : ''\}\$\{reconstructedQuery\(request\.query\)\}`/
  );
  assert.match(transport, /key === 'transport' \|\| key === 'path'/);
});
