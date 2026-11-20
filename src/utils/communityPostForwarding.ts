import {
  collection, doc, getDoc, runTransaction, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import type { CloudCommunityPost } from './communityCloud';
import { COMMUNITY_SQUARE_WINDOW_MS } from './communitySquareFeed';
import { recordCommunityPostForwardMetric } from './communityOrganicMetrics';

/**
 * A forward is an independent time-limited distribution event, NEVER a cloned
 * publication. One stable document per post/actor permits a new 24h discovery
 * window only after the previous 24h window has elapsed.
 *
 * The security rules enforce both server-time cooldown and public-source
 * eligibility, so client clock changes cannot bypass them.
 */
export const forwardCommunityPostToSquare = async (post: CloudCommunityPost): Promise<void> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Entre no Kyrub para encaminhar esta publicação.');

  const original = await getDoc(doc(db, 'community_posts', post.id));
  if (!original.exists() || original.data().communityId !== post.communityId) {
    throw new Error('A publicação original não está mais disponível.');
  }
  const community = await getDoc(doc(db, 'communities', post.communityId));
  if (!community.exists() || community.data().visibility !== 'public') {
    throw new Error('Somente publicações de comunidades públicas podem ser encaminhadas à Praça.');
  }

  const forwardId = `${post.id}__${user.uid}`;
  const reference = doc(db, 'community_square_forwards', forwardId);

  await runTransaction(db, async transaction => {
    const current = await transaction.get(reference);
    if (current.exists()) {
      const last = current.data().forwardedAt;
      if (!(last instanceof Timestamp) ||
          Date.now() - last.toMillis() < COMMUNITY_SQUARE_WINDOW_MS) {
        throw new Error('Você já encaminhou esta publicação à Praça nas últimas 24 horas.');
      }
      transaction.update(reference, { forwardedAt: serverTimestamp() });
    } else {
      transaction.set(reference, {
        postId: post.id,
        communityId: post.communityId,
        actorId: user.uid,
        actorName: (user.displayName || 'Kairubido').trim().slice(0, 160) || 'Kairubido',
        forwardedAt: serverTimestamp(),
      });
    }
  });

  // The content is already distributed; analytics must never roll it back.
  void recordCommunityPostForwardMetric(post).catch(error =>
    console.warn('Encaminhamento concluído, mas a métrica orgânica não foi registrada.', error)
  );
};

export const buildCommunityPostInternalLink = (post: CloudCommunityPost): string => {
  const url = new URL('/', window.location.origin);
  url.searchParams.set('community', post.communityId);
  url.searchParams.set('post', post.id);
  return url.toString();
};

export const composeCommunityForwardMessage = (post: CloudCommunityPost): string => {
  const preview = post.content.trim().replace(/\s+/g, ' ').slice(0, 170);
  return `Encaminhei uma publicação de ${post.authorName} no Kyrub.${preview ? '\n' + preview : ''}\n${buildCommunityPostInternalLink(post)}`;
};
