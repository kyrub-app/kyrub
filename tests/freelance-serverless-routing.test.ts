import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { handleFreelanceServerlessRequest } from '../server/freelance/freelanceServerlessTransport.js';

const cases = [
  ['/api/freelance/workspace', 'freelance-workspace', 'FREELANCE_DISABLED'],
  ['/api/freelance/finance', 'freelance-finance', 'FREELANCE_FINANCE_DISABLED'],
  ['/api/personal-finance/pix', 'personal-finance-pix', 'PERSONAL_FINANCE_DISABLED'],
  ['/api/admin/freelance-financial-review', 'freelance-financial-review', 'FREELANCE_FINANCIAL_REVIEW_DISABLED'],
] as const;

test('all four exact rewrites reuse existing multiplexer and preserve other routes', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
  for (const [source, surface] of cases) {
    const expected = (source.startsWith('/api/admin/') ? '/api/admin/operations/health' : '/api/health') + '?transport=' + surface;
    assert.deepEqual(config.rewrites.filter((r: {source: string}) => r.source === source), [{source, destination: expected}]);
    const entry = readFileSync(source.startsWith('/api/admin/') ? 'api/admin/operations/health.ts' : 'api/health.ts', 'utf8');
    assert.ok(entry.includes("transport === '" + surface + "'"));
    assert.match(entry, /await handleFreelanceServerlessRequest\(transport, request, response\)/);
  }
});

test('real handlers fail closed in Vercel, even with local flags enabled; routing selector cannot be ambiguous', async () => {
  const values = { VERCEL: '1', VERCEL_ENV: 'production', KYRUB_FREELANCE_LOCAL_HOMOLOGATION: 'true', KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION: 'true' };
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    for (const [, surface, expected] of cases) {
      for (const method of ['GET', 'POST']) {
        let status = 0; let body: unknown;
        const headers: Record<string,string> = {};
        const response = { setHeader(name: string, value: string) { headers[name.toLowerCase()] = value; }, status(code: number) { status = code; return {json(value: unknown) {body = value;}}; } };
        await handleFreelanceServerlessRequest(surface, {method,headers:{authorization:'Bearer fixture'},query:{transport:surface},body:{}}, response);
        assert.equal(status, 503);
        assert.deepEqual(body, {code: expected});
        assert.match(headers['cache-control'], /no-store/);
        await handleFreelanceServerlessRequest(surface, {method,headers:{},query:{transport:[surface,surface]}}, response);
        assert.equal(status, 400);
        assert.deepEqual(body, {code:'FREELANCE_INVALID_TRANSPORT'});
      }
    }
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
