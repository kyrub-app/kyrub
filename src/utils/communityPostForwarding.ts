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

export interface CommunityForwardReceipt {
  messageId: string;
  recipientId: string;
  connectionId: string;
}

/** The private message and per-target cooldown receipt are written atomically.
 * No chat message is sent when the same actor has forwarded the same publication
 * to this recipient within 24 hours. Firestore rules enforce the same constraint
 * using authoritative server time. Other recipients are independent destinations.
 */
export const sendCommunityPostToConnectedUser = async (input: {
  post: CloudCommunityPost;
  connectionId: string;
  recipientId: string;
  text: string;
}): Promise<CommunityForwardReceipt> => {
  const actorId = auth.currentUser?.uid;
  if (!actorId) throw new Error('Faça login para encaminhar a publicação.');
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.connectionId)
    || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.recipientId)
    || input.recipientId === actorId) throw new Error('Destinatário inválido.');
  const text = input.text.trim();
  if (!text || text.length > 4000 || !text.includes(buildCommunityPostInternalLink(input.post))) {
    throw new Error('O encaminhamento precisa conter a referência original da publicação.');
  }
  const receiptId = `${input.post.id}__${actorId}__${input.recipientId}`;
  const receiptRef = doc(db, 'community_direct_forward_receipts', receiptId);
  const messageRef = doc(collection(db, 'social_chats', input.connectionId, 'messages'));
  await runTransaction(db, async tx => {
    const receipt = await tx.get(receiptRef);
    if (receipt.exists()) {
      const last = receipt.data().forwardedAt;
      if (!(last instanceof Timestamp) ||
        Date.now() - last.toMillis() < COMMUNITY_SQUARE_WINDOW_MS) {
        throw new Error('Você já encaminhou esta publicação para esta pessoa nas últimas 24 horas.');
      }
    }

    tx.set(messageRef, {
      senderId: actorId,
      receiverId: input.recipientId,
      text,
      createdAt: serverTimestamp(),
    });
    if (receipt.exists()) {
      tx.update(receiptRef, {
        messageId: messageRef.id,
        forwardedAt: serverTimestamp(),
      });
    } else {
      tx.set(receiptRef, {
        postId: input.post.id,
        communityId: input.post.communityId,
        actorId,
        receiverId: input.recipientId,
        connectionId: input.connectionId,
        messageId: messageRef.id,
        forwardedAt: serverTimestamp(),
      });
    }
  });
  return { messageId: messageRef.id, recipientId: input.recipientId, connectionId: input.connectionId };
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
