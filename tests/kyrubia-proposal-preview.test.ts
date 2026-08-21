import assert from 'node:assert/strict';
import test from 'node:test';
import type { KyrubAiCreateNoteProposal } from '../shared/kyrubActions';
import {
  buildKyrubActionPreview,
  hashKyrubActionPreviewProposal,
} from '../server/actions/actionProposalPreview';

const proposal: KyrubAiCreateNoteProposal = {
  id: 'proposal-note-preview-1',
  type: 'create_note',
  title: 'Checklist',
  content: 'Comprar pão.',
  checklist: [],
  requiresConfirmation: true,
  origin: 'kyrubia',
  risk: 'low',
  inputProvenance: 'user_intent',
  impact: { entityCount: 1, reversibility: 'easy' },
};

test('proposal preview is deterministic and explicitly non-executable', () => {
  const first = buildKyrubActionPreview({
    proposal,
    correlationId: 'corr-preview-1',
    title: 'Criar nota',
    summary: 'Criar a nota Checklist.',
    evidenceRefs: ['conversation/message-1'],
    now: new Date('2026-08-21T13:00:00.000Z'),
  });
  const second = buildKyrubActionPreview({
    proposal,
    correlationId: 'corr-preview-1',
    title: 'Criar nota',
    summary: 'Criar a nota Checklist.',
    evidenceRefs: ['conversation/message-1'],
    now: new Date('2026-08-21T13:00:00.000Z'),
  });

  assert.equal(first.previewId, second.previewId);
  assert.equal(first.proposalHash, hashKyrubActionPreviewProposal(proposal));
  assert.equal(first.executionAllowed, false);
  assert.equal(first.requiresConfirmation, true);
  assert.equal(first.autonomyDecision.requestedLevel, 2);
});

test('runtime kill switch blocks preview creation before confirmation UX', () => {
  assert.throws(
    () => buildKyrubActionPreview({
      proposal,
      correlationId: 'corr-preview-2',
      title: 'Criar nota',
      summary: 'Criar a nota Checklist.',
      controls: { globalKillSwitch: true },
    }),
    /GLOBAL_KILL_SWITCH/
  );
});

test('preview preserves only bounded scalar expected state', () => {
  const preview = buildKyrubActionPreview({
    proposal,
    correlationId: 'corr-preview-3',
    title: 'Criar nota',
    summary: 'Criar a nota Checklist.',
    expectedState: {
      status: 'active',
      version: 4,
      privateDocument: { secret: true },
    },
  });

  assert.deepEqual(preview.expectedState, { status: 'active', version: 4 });
});
