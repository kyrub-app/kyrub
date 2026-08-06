import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type { CloudCommunityDebateComment } from './communityCloud.ts';

export * from './communityCloud.ts';

export const subscribeDebateComments = (
  debateId: string,
  onChange: (comments: CloudCommunityDebateComment[]) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  let disposed = false;
  let unsubscribeSnapshot: Unsubscribe | null = null;

  void getDoc(doc(db, 'community_debates', debateId))
    .then(debateSnapshot => {
      if (disposed) return;
      if (!debateSnapshot.exists()) {
        throw new Error('Debate não encontrado.');
      }

      const communityId = String(debateSnapshot.data().communityId ?? '').trim();
      if (!communityId) {
        throw new Error('O debate não está vinculado a uma comunidade válida.');
      }

      unsubscribeSnapshot = onSnapshot(
        query(
          collection(db, 'community_debate_comments'),
          where('communityId', '==', communityId),
          where('debateId', '==', debateId)
        ),
        snapshot => {
          const comments = snapshot.docs
            .map(item => {
              const data = item.data();
              const createdAt =
                typeof data.createdAtIso === 'string'
                  ? data.createdAtIso
                  : data.createdAt?.toDate?.().toISOString?.() ?? '';
              const updatedAt =
                typeof data.updatedAtIso === 'string'
                  ? data.updatedAtIso
                  : data.updatedAt?.toDate?.().toISOString?.() ?? createdAt;

              return {
                id: item.id,
                communityId: String(data.communityId ?? ''),
                debateId: String(data.debateId ?? ''),
                authorId: String(data.authorId ?? ''),
                authorName: String(data.authorName ?? 'Usuário Kyrub'),
                authorAvatar: String(data.authorAvatar ?? ''),
                text: String(data.text ?? '').trim(),
                parentCommentId: String(data.parentCommentId ?? ''),
                createdAt,
                updatedAt,
              } satisfies CloudCommunityDebateComment;
            })
            .filter(comment => comment.text)
            .sort(
              (left, right) =>
                Date.parse(left.createdAt) - Date.parse(right.createdAt)
            );

          onChange(comments);
        },
        error => onError?.(error)
      );
    })
    .catch(value => {
      if (disposed) return;
      onError?.(
        value instanceof Error
          ? value
          : new Error('Não foi possível carregar os comentários.')
      );
    });

  return () => {
    disposed = true;
    unsubscribeSnapshot?.();
  };
};
