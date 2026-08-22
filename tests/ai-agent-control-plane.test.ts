import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const agents = readFileSync(resolve(process.cwd(), 'AGENTS.md'), 'utf8');
const controlPlane = readFileSync(resolve(process.cwd(), 'docs/AI_AGENT_CONTROL_PLANE.md'), 'utf8');

test('repository defines bounded agent workstreams and forbids direct main writes', () => {
  for (const heading of [
    'A — Payments / Marketplace E2E',
    'B — Admin Integrations / Credentials Vault',
    'C — Gamification / Clubs',
    'D — External AI / MCP / Provider Router',
    'E — AI Operations / Agent Control Plane',
    'F — QA / Security / Infrastructure',
    'G — Legal / Compliance / Trust',
  ]) {
    assert.match(agents, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(agents, /Do not push directly to `main`/);
  assert.match(agents, /One workstream = one bounded branch\/PR/);
});

test('control plane requires task envelopes, handoffs and authoritative receipts', () => {
  assert.match(controlPlane, /## 5\. Task Envelope/);
  assert.match(controlPlane, /## 6\. Agent Handoff/);
  assert.match(controlPlane, /## 7\. Execution Receipt/);
  assert.match(controlPlane, /Do not fabricate timestamps, CI states or deployment evidence/);
  assert.match(controlPlane, /When agents disagree:/);
});

test('high-risk domain boundaries remain explicit', () => {
  assert.match(agents, /Never infer financial truth from browser\/UI state/);
  assert.match(agents, /PSP\/webhook\/server-authoritative state owns payment confirmation/);
  assert.match(agents, /raw secrets must not be persisted in ordinary Firestore documents/);
  assert.match(agents, /K-Coins are not money/);
  assert.match(agents, /external agents never receive direct arbitrary Firestore access/);
  assert.match(controlPlane, /Reward value and financial settlement remain separate domains/);
});

test('initial delegation queue preserves parallel ownership', () => {
  assert.match(controlPlane, /`payments-agent`: Mercado Pago \/ marketplace Pix E2E/);
  assert.match(controlPlane, /`platform-secrets-agent`: Credentials Vault foundation/);
  assert.match(controlPlane, /`gamification-agent`: domain foundation first/);
  assert.match(controlPlane, /`qa-security-agent`: independent review across the three streams/);
});