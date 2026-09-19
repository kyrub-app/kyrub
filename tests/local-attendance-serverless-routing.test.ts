import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Vercel exposes canonical local attendance through its dedicated serverless entrypoint', () => {
  const vercel = readFileSync('vercel.json', 'utf8');
  const entrypoint = readFileSync('api/local-attendance.ts', 'utf8');
  const transport = readFileSync(
    'server/attendance/localAttendanceServerlessTransport.ts',
    'utf8'
  );

  assert.match(vercel, /"source": "\/api\/local-attendance\/:path\*"/);
  assert.match(
    vercel,
    /"destination": "\/api\/local-attendance\?path=:path\*"/
  );
  assert.match(entrypoint, /handleLocalAttendanceServerlessRequest/);
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
