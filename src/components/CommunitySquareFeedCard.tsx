import { useEffect, useState } from 'react';
import { ArrowUpRight, UsersRound } from 'lucide-react';
import { CommunityPostCard } from './CommunityPostCard';
import { useLiveAuthorIdentities } from '../hooks/useLiveAuthorIdentities';
import { displayAuthorName, displayAuthorAvatar } from '../utils/authorDisplayIdentity';
import {
  subscribeCommunityPostInteractions, toggleCommunityPostLike, addCommunityPostComment,
  deleteCommunityPostComment, setCommunityPostPinnedComment, submitCommunityPostReport, removeOwnCommunityPost,
  type CommunityPostLike, type CommunityPostComment,
} from '../utils/communityPostInteractions';
import type { CommunityPostConnection } from '../utils/communityPostConnections';
import { toggleCommunityPostSaveWithMetrics } from '../utils/communityOrganicMetrics';
import {
  OPEN_COMMUNITY_FROM_SQUARE_EVENT, removeCommunityPostFromSquare,
  type CommunitySquareEntry,
} from '../utils/communitySquareFeed';

interface Props {
  entry: CommunitySquareEntry;
  viewerId: string;
  canParticipate: boolean;
  saved: boolean;
  connection?: CommunityPostConnection;
}

export function CommunitySquareFeedCard({ entry, viewerId, canParticipate, saved, connection }: Props) {
  const [likes, setLikes] = useState<CommunityPostLike[]>([]);
  const [comments, setComments] = useState<CommunityPostComment[]>([]);
  const [error, setError] = useState('');
  const { post } = entry;
  const liveAuthors = useLiveAuthorIdentities([...(post.institutionalChallengeId ? [] : [post.authorId]), entry.forwardedById || '']);
  const authorName = post.institutionalChallengeId ? 'Kyrub Oficial' : displayAuthorName(post.authorId, post.authorName, liveAuthors);
  const displayPost = { ...post, authorName, authorAvatar: displayAuthorAvatar(post.authorId, post.authorAvatar, liveAuthors) };
  const forwardedByName = entry.forwardedById
    ? displayAuthorName(entry.forwardedById, entry.forwardedByName || 'Kairubido', liveAuthors)
    : '';

  useEffect(() => {
    setLikes([]);
    setComments([]);
    return subscribeCommunityPostInteractions(
      post.communityId, setLikes, setComments,
      () => setError('As interações desta comunidade estão temporariamente indisponíveis.'),
    );
  }, [post.communityId]);

  return (
    <section className="space-y-2" aria-label={`Publicação da comunidade ${entry.communityName}`}>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent(OPEN_COMMUNITY_FROM_SQUARE_EVENT, {
          detail: { communityId: entry.communityId, postId: post.id },
        }))}
        className="flex min-h-10 w-full items-center gap-2 rounded-xl border border-teal-800/50 bg-teal-950/30 px-3 py-2 text-left text-sm text-teal-200"
        aria-label={`Visitar a comunidade ${entry.communityName}`}
      >
        <UsersRound className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">Publicado em: <strong>{entry.communityName}</strong></span>
        <ArrowUpRight className="h-4 w-4 shrink-0" />
      </button>
      {entry.forwardedById && (
        <p className="px-2 text-xs text-teal-200">
          Encaminhado à Praça por <strong>{forwardedByName}</strong>
          {' · '}publicação original de {authorName}
        </p>
      )}
      {error && <p role="alert" className="text-xs text-amber-300">{error}</p>}
      <CommunityPostCard
        post={displayPost}
        viewerId={viewerId}
        canParticipate={canParticipate}
        communityOwnerId={entry.communityOwnerId}
        likes={likes}
        comments={comments}
        connection={connection}
        saved={saved}
        onToggleSave={() => toggleCommunityPostSaveWithMetrics(post, saved)}
        onToggleLike={isLiked => toggleCommunityPostLike(post, isLiked)}
        onComment={(text, parentCommentId) => addCommunityPostComment(post, text, parentCommentId)}
        onDeleteComment={deleteCommunityPostComment}
        onPinComment={commentId => setCommunityPostPinnedComment(post, commentId)}
        onReport={reason => submitCommunityPostReport(post, reason)}
        onRemove={() => removeOwnCommunityPost(post)}
        squarePublished
        onToggleSquare={() => removeCommunityPostFromSquare(post)}
      />
    </section>
  );
}
