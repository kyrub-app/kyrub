import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { KyrubAiCreateNoteProposal } from '../shared/kyrubActions';
import {
  buildKyrubExecutionEnvelope,
  hashKyrubActionProposal,
  normalizeCreateNoteExecutionProposal,
} from '../server/actions/actionExecutionService';
import { evaluateKyrubActionPolicy } from '../server/actions/kyrubiaPolicyEngine';

const noteProposal = (
  overrides: Partial<KyrubAiCreateNoteProposal> = {}
): KyrubAiCreateNoteProposal => ({
  id: 'proposal-note-1',
  type: 'create_note',
  title: 'Lista de compras',
  content: 'Comprar leite e pão.',
  checklist: [],
  requiresConfirmation: true,
  origin: 'kyrubia',
  risk: 'low',
  inputProvenance: 'user_intent',
  impact: {
    entityCount: 1,
    reversibility: 'easy',
  },
  ...overrides,
});

const baseContext = {
  actorUid: 'user-1',
  permissions: ['notes.write'],
  now: new Date('2026-08-08T22:00:00.000Z'),
  decisionId: 'decision-1',
};

test('write actions require confirmation even when permission and provenance are valid', () => {
  const decision = evaluateKyrubActionPolicy(noteProposal(), {
    ...baseContext,
    confirmed: false,
  });

  assert.equal(decision.outcome, 'require_confirmation');
  assert.deepEqual(decision.reasons, ['CONFIRMATION_REQUIRED']);
});

test('a confirmed low-impact user-intent note is allowed', () => {
  const decision = evaluateKyrubActionPolicy(noteProposal(), {
    ...baseContext,
    confirmed: true,
  });

  assert.equal(decision.outcome, 'allow');
  assert.deepEqual(decision.reasons, []);
  assert.equal(decision.maxAffectedEntities, 1);
});

test('quoted content is never promoted to write authority', () => {
  const decision = evaluateKyrubActionPolicy(
    noteProposal({ inputProvenance: 'quoted_content' }),
    { ...baseContext, confirmed: true }
  );

  assert.equal(decision.outcome, 'deny');
  assert.ok(decision.reasons.includes('WRITE_REQUIRES_USER_INTENT'));
});

test('permission is evaluated independently from confirmation', () => {
  const decision = evaluateKyrubActionPolicy(noteProposal(), {
    ...baseContext,
    permissions: [],
    confirmed: true,
  });

  assert.equal(decision.outcome, 'deny');
  assert.ok(decision.reasons.includes('PERMISSION_REQUIRED'));
});

test('blast radius is bounded by the registered action policy', () => {
  const decision = evaluateKyrubActionPolicy(
    noteProposal({
      impact: {
        entityCount: 2,
        reversibility: 'easy',
      },
    }),
    { ...baseContext, confirmed: true }
  );

  assert.equal(decision.outcome, 'deny');
  assert.ok(decision.reasons.includes('BLAST_RADIUS_EXCEEDED'));
});

test('invalid action impact is denied before execution', () => {
  const decision = evaluateKyrubActionPolicy(
    noteProposal({
      impact: {
        entityCount: 1,
        reversibility: 'easy',
        financialExposureMinor: 100,
      },
    }),
    { ...baseContext, confirmed: true }
  );

  assert.equal(decision.outcome, 'deny');
  assert.ok(decision.reasons.includes('INVALID_IMPACT'));
});

test('safe execution policy remains deterministic and model-free', () => {
  const first = evaluateKyrubActionPolicy(noteProposal(), {
    ...baseContext,
    confirmed: true,
  });
  const second = evaluateKyrubActionPolicy(noteProposal(), {
    ...baseContext,
    confirmed: true,
  });

  assert.deepEqual(first, second);
});

test('server normalization owns the blast radius for create_note', () => {
  const normalized = normalizeCreateNoteExecutionProposal({
    ...noteProposal(),
    impact: {
      entityCount: 999,
      reversibility: 'hard',
      financialExposureMinor: 999_999,
      financialCurrency: 'BRL',
    },
  });

  assert.deepEqual(normalized.impact, {
    entityCount: 1,
    reversibility: 'easy',
  });
});

test('missing provenance is conservative and cannot become write authority', () => {
  const raw = noteProposal();
  delete (raw as Partial<KyrubAiCreateNoteProposal>).inputProvenance;
  const normalized = normalizeCreateNoteExecutionProposal(raw);
  const decision = evaluateKyrubActionPolicy(normalized, {
    ...baseContext,
    confirmed: true,
  });

  assert.equal(normalized.inputProvenance, 'ai_generated_content');
  assert.equal(decision.outcome, 'deny');
  assert.ok(decision.reasons.includes('WRITE_REQUIRES_USER_INTENT'));
});

test('execution envelope is bound to the exact normalized proposal hash', () => {
  const proposal = noteProposal({ idempotencyKey: 'idem-1' });
  const decision = evaluateKyrubActionPolicy(proposal, {
    ...baseContext,
    confirmed: true,
  });
  const now = new Date('2026-08-08T22:05:00.000Z');
  const envelope = buildKyrubExecutionEnvelope(
    proposal,
    'user-1',
    'idem-1',
    decision,
    now
  );

  assert.equal(envelope.proposalHash, hashKyrubActionProposal(proposal, 'idem-1'));
  assert.equal(envelope.actorUid, 'user-1');
  assert.equal(envelope.policyDecisionId, decision.id);
  assert.equal(envelope.authorizationMode, 'human_confirmation');
  assert.equal(envelope.authorizedAt, now.toISOString());

  const changed = noteProposal({
    content: 'Conteúdo alterado depois da autorização.',
    idempotencyKey: 'idem-1',
  });
  assert.notEqual(
    envelope.proposalHash,
    hashKyrubActionProposal(changed, 'idem-1')
  );
});

test('Kyrubia note client no longer writes Firestore directly', () => {
  const source = readFileSync(
    new URL('../src/actions/noteActionService.ts', import.meta.url),
    'utf8'
  );

  assert.match(source, /\/api\/actions\/execute/);
  assert.doesNotMatch(source, /firebase\/firestore/);
  assert.doesNotMatch(source, /runTransaction\s*\(/);
  assert.doesNotMatch(source, /transaction\.set\s*\(/);
});
