/** Shared display order for community, Praça and profile comments.
 * Parent references are immutable and validated by Firestore on creation.
 * Missing/deleted parents are displayed as roots rather than hiding replies. */
export interface CommentThreadNode {
  id: string;
  postId: string;
  parentCommentId?: string;
  createdAt: string;
}

export interface OrderedComment<T extends CommentThreadNode> {
  comment: T;
  parent?: T;
  rootId: string;
  depth: number;
}

export const orderCommentThreads = <T extends CommentThreadNode>(
  comments: readonly T[],
): OrderedComment<T>[] => {
  const sorted = [...comments].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  );
  const byId = new Map(sorted.map(comment => [comment.id, comment]));
  const children = new Map<string, T[]>();
  const roots: T[] = [];

  for (const comment of sorted) {
    const parent = comment.parentCommentId
      ? byId.get(comment.parentCommentId)
      : undefined;
    if (!parent || parent.id === comment.id || parent.postId !== comment.postId) {
      roots.push(comment);
      continue;
    }
    const siblings = children.get(parent.id) ?? [];
    siblings.push(comment);
    children.set(parent.id, siblings);
  }

  const result: OrderedComment<T>[] = [];
  const visited = new Set<string>();
  const visit = (comment: T, rootId: string, depth: number): void => {
    if (visited.has(comment.id)) return; // Guard legacy malformed cycles.
    visited.add(comment.id);
    const parent = comment.parentCommentId
      ? byId.get(comment.parentCommentId)
      : undefined;
    result.push({
      comment,
      parent: parent?.postId === comment.postId ? parent : undefined,
      rootId,
      depth,
    });
    for (const child of children.get(comment.id) ?? []) {
      visit(child, rootId, depth + 1);
    }
  };
  for (const root of roots) visit(root, root.id, 0);
  for (const orphan of sorted) {
    if (!visited.has(orphan.id)) visit(orphan, orphan.id, 0);
  }
  return result;
};
