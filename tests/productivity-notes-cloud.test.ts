import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Note } from '../src/types';
import {
  decodeNoteCollaborator,
  encodeNoteCollaborator,
  getNoteUpdatedAt,
  mergeNoteVersions,
  normalizeCollaboratorSelections,
  sanitizeCloudMediaUrls,
  sortNotesByUpdatedAt,
} from '../src/utils/noteCollaboration';

const makeNote = (
  id: string,
  updatedAt: string,
  content: string,
  syncState: Note['syncState'] = 'synced'
): Note => ({
  id,
  title: id.toUpperCase(),
  content,
  associatedUsers: ['Você'],
  checklist: [],
  auditLogs: [
    {
      user: 'Você',
      action: 'Atualizou a nota',
      timestamp: updatedAt,
    },
  ],
  updatedAt,
  createdAt: updatedAt,
  mediaUrls: [],
  syncState,
});

test('collaborator selections retain the real user uid', () => {
  const encoded = encodeNoteCollaborator({
    uid: 'uid-colaborador',
    name: 'Maria Silva',
    email: 'maria@example.com',
    avatar: 'https://example.com/avatar.png',
  });
  const decoded = decodeNoteCollaborator(encoded);

  assert.equal(decoded.uid, 'uid-colaborador');
  assert.equal(decoded.name, 'Maria Silva');
  assert.equal(decoded.email, 'maria@example.com');

  const normalized = normalizeCollaboratorSelections([
    encoded,
    encoded,
    encodeNoteCollaborator({ uid: 'uid-2', name: 'João' }),
  ]);

  assert.deepEqual(
    normalized.map(item => item.uid),
    ['uid-colaborador', 'uid-2']
  );
});

test('cloud note payload excludes local data-url attachments', () => {
  assert.deepEqual(
    sanitizeCloudMediaUrls([
      'data:image/png;base64,abc',
      'blob:https://kyrub.test/local',
      'https://cdn.example.com/photo.jpg',
      'http://cdn.example.com/video.mp4',
    ]),
    [
      'https://cdn.example.com/photo.jpg',
      'http://cdn.example.com/video.mp4',
    ]
  );
});

test('offline and remote note versions reconcile by latest update', () => {
  const remote = makeNote(
    'note-1',
    '2026-07-24T10:00:00.000Z',
    'versão remota'
  );
  const local = {
    ...makeNote(
      'note-1',
      '2026-07-24T11:00:00.000Z',
      'versão local mais recente',
      'pending'
    ),
    mediaUrls: ['data:image/png;base64,local'],
  };

  const merged = mergeNoteVersions(local, remote);
  assert.equal(merged.content, 'versão local mais recente');
  assert.equal(merged.syncState, 'pending');
  assert.deepEqual(merged.mediaUrls, ['data:image/png;base64,local']);
  assert.equal(getNoteUpdatedAt(merged), Date.parse(local.updatedAt!));

  assert.deepEqual(
    sortNotesByUpdatedAt([
      remote,
      makeNote('note-2', '2026-07-24T12:00:00.000Z', 'mais nova'),
    ]).map(note => note.id),
    ['note-2', 'note-1']
  );
});

test('notes use Firestore persistence and a direct invitation inbox', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const hookSource = readFileSync(
    'src/hooks/useProductivityNotes.ts',
    'utf8'
  );
  const outboxSource = readFileSync(
    'src/components/NoteInvitationOutboxBridge.tsx',
    'utf8'
  );
  const sharedModalSource = readFileSync(
    'src/components/modals/SharedNotesModal.tsx',
    'utf8'
  );
  const participantEditorSource = readFileSync(
    'src/components/modals/SharedNoteParticipantEditor.tsx',
    'utf8'
  );
  const noteTabSource = readFileSync(
    'src/components/tabs/PerfilTab.tsx',
    'utf8'
  );
  const firebaseSource = readFileSync('src/utils/firebase.ts', 'utf8');
  const firebaseConfig = JSON.parse(readFileSync('firebase.json', 'utf8'));

  assert.match(
    hookSource,
    /collection\(db, 'users', user\.uid, 'tasks'\)/
  );
  assert.match(hookSource, /setDoc\(/);
  assert.match(hookSource, /getUserNotesKey\(user\.uid\)/);
  assert.doesNotMatch(hookSource, /LEGACY_NOTES_KEY/);

  assert.match(appSource, /<NoteInvitationOutboxBridge \/>/);
  assert.match(
    outboxSource,
    /collection\(db, 'users', user\.uid, 'tasks'\)/
  );
  assert.match(outboxSource, /'note_invitations'/);
  assert.match(outboxSource, /status: 'pending'/);
  assert.match(outboxSource, /status: 'revoked'/);
  assert.doesNotMatch(outboxSource, /\bgetDoc\(/);
  assert.match(outboxSource, /invitationsReadyFromServer/);
  assert.match(outboxSource, /pendingCreateIds/);

  assert.match(sharedModalSource, /collection\(db, 'note_invitations'\)/);
  assert.match(
    sharedModalSource,
    /where\('recipientId', '==', user\.uid\)/
  );
  assert.match(
    sharedModalSource,
    /doc\(db, 'users', invitation\.ownerId, 'tasks', invitation\.noteId\)/
  );
  assert.match(sharedModalSource, /status: nextStatus/);
  assert.match(sharedModalSource, /acceptedWith: arrayUnion\(user\.uid\)/);
  assert.match(sharedModalSource, /Solicitações/);
  assert.match(sharedModalSource, /Participando/);
  assert.match(sharedModalSource, /Abrir e editar nota/);
  assert.match(sharedModalSource, /<SharedNoteParticipantEditor/);

  assert.match(participantEditorSource, /Editar nota compartilhada/);
  assert.match(participantEditorSource, /Salvar alterações/);
  assert.match(participantEditorSource, /title: normalizedTitle/);
  assert.match(participantEditorSource, /content: normalizedContent/);
  assert.match(participantEditorSource, /checklist: normalizedChecklist/);
  assert.match(
    participantEditorSource,
    /Editou \$\{changedSections\.join\(', '\)\} como participante/
  );
  assert.match(
    participantEditorSource,
    /doc\(db, 'note_invitations', invitation\.id\)/
  );

  assert.match(noteTabSource, /Histórico de alterações/);
  assert.match(noteTabSource, /aria-label="Publicar nota no feed"/);
  assert.doesNotMatch(noteTabSource, />Compartilhar<\/span>/);

  assert.match(firebaseSource, /persistentLocalCache/);
  assert.match(firebaseSource, /persistentMultipleTabManager/);
  assert.equal(firebaseConfig.firestore.indexes, 'firestore.indexes.json');
});

test('profile panel is organized and does not claim to store sensitive data publicly', () => {
  const profileSource = readFileSync(
    'src/components/modals/UserProfileModal.tsx',
    'utf8'
  );

  assert.match(profileSource, /type ProfileSection = 'conta' \| 'dados' \| 'seguranca' \| 'verificacao'/);
  assert.match(profileSource, /Salvar perfil público/);
  assert.match(profileSource, /updateDoc\(doc\(db, 'users', user\.uid\)/);
  assert.match(profileSource, /não envia nem armazena o PIN no Firestore/);
  assert.doesNotMatch(profileSource, /Simulate Firebase Write I\/O latency/);
});
