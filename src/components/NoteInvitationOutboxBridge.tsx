import { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
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

export function NoteInvitationOutboxBridge() {
  useEffect(() => {
    let unsubscribeTasks = () => undefined;
    let unsubscribeInvitations = () => undefined;
    let cancelled = false;
    let tasksReadyFromServer = false;
    let expectedInvitationIds = new Set<string>();
    let ownerInvitations: InvitationRecord[] = [];

    const reconcileRevokedInvitations = () => {
      if (!tasksReadyFromServer || cancelled) return;

      for (const invitation of ownerInvitations) {
        if (
          expectedInvitationIds.has(invitation.id) ||
          invitation.status === 'declined' ||
          invitation.status === 'revoked'
        ) {
          continue;
        }

        void updateDoc(doc(db, 'note_invitations', invitation.id), {
          status: 'revoked',
          updatedAt: serverTimestamp(),
        }).catch(error => {
          console.warn('Não foi possível revogar um convite removido.', error);
        });
      }
    };

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeTasks();
      unsubscribeInvitations();
      tasksReadyFromServer = false;
      expectedInvitationIds = new Set<string>();
      ownerInvitations = [];

      if (!user) return;

      unsubscribeInvitations = onSnapshot(
        query(
          collection(db, 'note_invitations'),
          where('ownerId', '==', user.uid)
        ),
        snapshot => {
          ownerInvitations = snapshot.docs.map(snapshotDocument => {
            const data = snapshotDocument.data() as Record<string, unknown>;
            return {
              id: snapshotDocument.id,
              status: readString(data.status),
            };
          });
          reconcileRevokedInvitations();
        },
        error => {
          console.warn('Caixa de convites do proprietário indisponível.', error);
        }
      );

      unsubscribeTasks = onSnapshot(
        collection(db, 'users', user.uid, 'tasks'),
        { includeMetadataChanges: true },
        snapshot => {
          const nextExpectedIds = new Set<string>();

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
              nextExpectedIds.add(invitationId);
              const invitationReference = doc(
                db,
                'note_invitations',
                invitationId
              );

              void getDoc(invitationReference)
                .then(async invitationSnapshot => {
                  if (cancelled) return;

                  const commonPayload = {
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
                    updatedAt: serverTimestamp(),
                  };

                  if (!invitationSnapshot.exists()) {
                    await setDoc(invitationReference, {
                      ...commonPayload,
                      status: 'pending',
                      createdAt: serverTimestamp(),
                    });
                    return;
                  }

                  const existingStatus = readString(
                    invitationSnapshot.data().status
                  );
                  await setDoc(
                    invitationReference,
                    {
                      ...commonPayload,
                      ...(existingStatus === 'revoked'
                        ? { status: 'pending' }
                        : {}),
                    },
                    { merge: true }
                  );
                })
                .catch(error => {
                  console.warn(
                    'Não foi possível sincronizar um convite de nota.',
                    error
                  );
                });
            }
          }

          expectedInvitationIds = nextExpectedIds;
          if (!snapshot.metadata.fromCache) {
            tasksReadyFromServer = true;
          }
          reconcileRevokedInvitations();
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
