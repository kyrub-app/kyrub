import { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db } from '../utils/firebase';

interface CollaboratorRecord {
  uid: string;
  name: string;
  email: string;
  avatar: string;
}

interface InvitationRecord {
  id: string;
  status: string;
  ownerName: string;
  ownerEmail: string;
  recipientName: string;
  recipientEmail: string;
  recipientAvatar: string;
  noteUpdatedAtIso: string;
}

interface ExpectedInvitation {
  id: string;
  payload: {
    ownerId: string;
    ownerName: string;
    ownerEmail: string;
    recipientId: string;
    recipientName: string;
    recipientEmail: string;
    recipientAvatar: string;
    noteId: string;
    sourcePath: string;
    noteUpdatedAtIso: string;
  };
}

const readString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const normalizeCollaborators = (
  value: unknown,
  sharedWith: string[]
): CollaboratorRecord[] => {
  const records = Array.isArray(value)
    ? value.flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        const data = item as Record<string, unknown>;
        const uid = readString(data.uid);
        if (!uid) return [];
        return [{
          uid,
          name: readString(data.name) || 'Usuário Kyrub',
          email: readString(data.email),
          avatar: readString(data.avatar),
        }];
      })
    : [];

  const byUid = new Map(records.map(record => [record.uid, record]));
  for (const uid of sharedWith) {
    if (!byUid.has(uid)) {
      byUid.set(uid, {
        uid,
        name: 'Usuário Kyrub',
        email: '',
        avatar: '',
      });
    }
  }

  return [...byUid.values()];
};

const invitationIdFor = (
  ownerId: string,
  noteId: string,
  recipientId: string
): string => `${ownerId}__${noteId}__${recipientId}`;

const invitationMetadataChanged = (
  existing: InvitationRecord,
  expected: ExpectedInvitation
): boolean =>
  existing.ownerName !== expected.payload.ownerName ||
  existing.ownerEmail !== expected.payload.ownerEmail ||
  existing.recipientName !== expected.payload.recipientName ||
  existing.recipientEmail !== expected.payload.recipientEmail ||
  existing.recipientAvatar !== expected.payload.recipientAvatar ||
  existing.noteUpdatedAtIso !== expected.payload.noteUpdatedAtIso;

export function NoteInvitationOutboxBridge() {
  useEffect(() => {
    let unsubscribeTasks = () => undefined;
    let unsubscribeInvitations = () => undefined;
    let cancelled = false;
    let tasksReadyFromServer = false;
    let invitationsReadyFromServer = false;
    let expectedInvitations = new Map<string, ExpectedInvitation>();
    let ownerInvitations = new Map<string, InvitationRecord>();
    const pendingCreateIds = new Set<string>();
    const pendingUpdateIds = new Set<string>();

    const reconcileRevokedInvitations = () => {
      if (
        !tasksReadyFromServer ||
        !invitationsReadyFromServer ||
        cancelled
      ) {
        return;
      }

      for (const invitation of ownerInvitations.values()) {
        if (
          expectedInvitations.has(invitation.id) ||
          invitation.status === 'declined' ||
          invitation.status === 'revoked' ||
          pendingUpdateIds.has(invitation.id)
        ) {
          continue;
        }

        pendingUpdateIds.add(invitation.id);
        void updateDoc(doc(db, 'note_invitations', invitation.id), {
          status: 'revoked',
          updatedAt: serverTimestamp(),
        })
          .catch(error => {
            console.warn('Não foi possível revogar um convite removido.', error);
          })
          .finally(() => {
            pendingUpdateIds.delete(invitation.id);
          });
      }
    };

    const synchronizeExpectedInvitations = () => {
      if (
        !tasksReadyFromServer ||
        !invitationsReadyFromServer ||
        cancelled
      ) {
        return;
      }

      for (const expected of expectedInvitations.values()) {
        const existing = ownerInvitations.get(expected.id);
        const invitationReference = doc(
          db,
          'note_invitations',
          expected.id
        );

        if (!existing) {
          if (pendingCreateIds.has(expected.id)) continue;

          pendingCreateIds.add(expected.id);
          void setDoc(invitationReference, {
            ...expected.payload,
            status: 'pending',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }).catch(error => {
            pendingCreateIds.delete(expected.id);
            console.warn(
              'Não foi possível criar um convite de participação em nota.',
              error
            );
          });
          continue;
        }

        if (
          pendingUpdateIds.has(expected.id) ||
          (
            existing.status !== 'revoked' &&
            !invitationMetadataChanged(existing, expected)
          )
        ) {
          continue;
        }

        pendingUpdateIds.add(expected.id);
        void setDoc(
          invitationReference,
          {
            ...expected.payload,
            ...(existing.status === 'revoked'
              ? { status: 'pending' }
              : {}),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        )
          .catch(error => {
            console.warn(
              'Não foi possível atualizar um convite de participação em nota.',
              error
            );
          })
          .finally(() => {
            pendingUpdateIds.delete(expected.id);
          });
      }

      reconcileRevokedInvitations();
    };

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeTasks();
      unsubscribeInvitations();
      tasksReadyFromServer = false;
      invitationsReadyFromServer = false;
      expectedInvitations = new Map<string, ExpectedInvitation>();
      ownerInvitations = new Map<string, InvitationRecord>();
      pendingCreateIds.clear();
      pendingUpdateIds.clear();

      if (!user) return;

      unsubscribeInvitations = onSnapshot(
        query(
          collection(db, 'note_invitations'),
          where('ownerId', '==', user.uid)
        ),
        { includeMetadataChanges: true },
        snapshot => {
          ownerInvitations = new Map(
            snapshot.docs.map(snapshotDocument => {
              const data = snapshotDocument.data() as Record<string, unknown>;
              const record: InvitationRecord = {
                id: snapshotDocument.id,
                status: readString(data.status),
                ownerName: readString(data.ownerName),
                ownerEmail: readString(data.ownerEmail),
                recipientName: readString(data.recipientName),
                recipientEmail: readString(data.recipientEmail),
                recipientAvatar: readString(data.recipientAvatar),
                noteUpdatedAtIso: readString(data.noteUpdatedAtIso),
              };
              pendingCreateIds.delete(record.id);
              return [record.id, record] as const;
            })
          );

          if (!snapshot.metadata.fromCache) {
            invitationsReadyFromServer = true;
          }

          synchronizeExpectedInvitations();
        },
        error => {
          console.warn('Caixa de convites do proprietário indisponível.', error);
        }
      );

      unsubscribeTasks = onSnapshot(
        collection(db, 'users', user.uid, 'tasks'),
        { includeMetadataChanges: true },
        snapshot => {
          const nextExpectedInvitations = new Map<string, ExpectedInvitation>();

          for (const taskSnapshot of snapshot.docs) {
            const data = taskSnapshot.data() as Record<string, unknown>;
            const sharedWith = Array.isArray(data.sharedWith)
              ? data.sharedWith.filter(
                  (value): value is string =>
                    typeof value === 'string' && value.trim().length > 0
                )
              : [];
            const collaborators = normalizeCollaborators(
              data.collaborators,
              sharedWith
            );

            for (const collaborator of collaborators) {
              if (collaborator.uid === user.uid) continue;

              const invitationId = invitationIdFor(
                user.uid,
                taskSnapshot.id,
                collaborator.uid
              );
              nextExpectedInvitations.set(invitationId, {
                id: invitationId,
                payload: {
                  ownerId: user.uid,
                  ownerName:
                    readString(data.ownerName) ||
                    user.displayName ||
                    user.email ||
                    'Usuário Kyrub',
                  ownerEmail: readString(data.ownerEmail) || user.email || '',
                  recipientId: collaborator.uid,
                  recipientName: collaborator.name,
                  recipientEmail: collaborator.email,
                  recipientAvatar: collaborator.avatar,
                  noteId: taskSnapshot.id,
                  sourcePath: `users/${user.uid}/tasks/${taskSnapshot.id}`,
                  noteUpdatedAtIso: readString(data.updatedAtIso),
                },
              });
            }
          }

          expectedInvitations = nextExpectedInvitations;
          if (!snapshot.metadata.fromCache) {
            tasksReadyFromServer = true;
          }
          synchronizeExpectedInvitations();
        },
        error => {
          console.warn('Não foi possível observar notas para convites.', error);
        }
      );
    });

    return () => {
      cancelled = true;
      unsubscribeAuth();
      unsubscribeTasks();
      unsubscribeInvitations();
    };
  }, []);

  return null;
}
