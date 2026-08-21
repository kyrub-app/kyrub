import assert from 'node:assert/strict';
import test from 'node:test';
import type { KyrubAiCreateNoteProposal } from '../shared/kyrubActions';
import { buildKyrubActionPreview } from '../server/actions/actionProposalPreview';
import {
  assertKyrubPreviewAuthorization,
  buildKyrubPreviewAuthorization,
} from '../server/actions/previewAuthorization';

const proposal: KyrubAiCreateNoteProposal = {
  id: 'proposal-auth-1',
  type: 'create_note',
  title: 'Nota',
  content: 'Conteúdo',
  checklist: [],
  requiresConfirmation: true,
  origin: 'kyrubia',
  risk: 'low',
  inputProvenance: 'user_intent',
  impact: { entityCount: 1, reversibility: 'easy' },
};

const preview = buildKyrubActionPreview({
  proposal,
  correlationId: 'corr-auth-1',
  title: 'Criar nota',
  summary: 'Criar a nota Nota.',
  target: { entityType: 'note_collection', entityId: 'user-1', label: 'Notas' },
  expectedState: { version: 2 },
  now: new Date('2026-08-21T13:00:00.000Z'),
});

test('authorization binds actor, preview, proposal hash and correlation id', () => {
  const authorization = buildKyrubPreviewAuthorization({
    preview,
    actorUid: 'user-1',
    confirmedPreviewId: preview.previewId,
    confirmedProposalHash: preview.proposalHash,
    now: new Date('2026-08-21T13:01:00.000Z'),
  });

  assert.equal(authorization.previewId, preview.previewId);
  assert.equal(authorization.proposalHash, preview.proposalHash);
  assert.equal(authorization.actorUid, 'user-1');
  assert.equal(authorization.correlationId, 'corr-auth-1');
  assert.equal(authorization.singleUse, true);
});

test('confirmation cannot authorize a different preview or proposal', () => {
  assert.throws(
    () => buildKyrubPreviewAuthorization({
      preview,
      actorUid: 'user-1',
      confirmedPreviewId: 'preview-wrong',
      confirmedProposalHash: preview.proposalHash,
      now: new Date('2026-08-21T13:01:00.000Z'),
    }),
    /PREVIEW_CONFIRMATION_MISMATCH/
  );
});

test('stale expected state is rejected before mutation', () => {
  const authorization = buildKyrubPreviewAuthorization({
    preview,
    actorUid: 'user-1',
    confirmedPreviewId: preview.previewId,
    confirmedProposalHash: preview.proposalHash,
    now: new Date('2026-08-21T13:01:00.000Z'),
  });

  assert.throws(
    () => assertKyrubPreviewAuthorization({
      authorization,
      preview,
      actorUid: 'user-1',
      observedState: { version: 3 },
      now: new Date('2026-08-21T13:01:30.000Z'),
    }),
    error => error instanceof Error && /mudou desde/i.test(error.message)
  );
});

test('expired preview cannot be freshly authorized', () => {
  assert.throws(
    () => buildKyrubPreviewAuthorization({
      preview,
      actorUid: 'user-1',
      confirmedPreviewId: preview.previewId,
      confirmedProposalHash: preview.proposalHash,
      now: new Date('2026-08-21T13:06:00.000Z'),
    }),
    /PREVIEW_EXPIRED/
  );
});
