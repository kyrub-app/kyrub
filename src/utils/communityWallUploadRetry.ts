// Session-local retry state. Never share an attachment between different
// publication attempts. No deletes, durable cache, or new infrastructure.
export type WallUploadAttempt = { id: string; started: boolean; url?: string };
export type WallDraft<T> = {
  owner: object;
  communityId: string;
  fingerprint: string;
  postId: string;
  attachments: readonly T[];
  uploads: WallUploadAttempt[];
  commitStarted: boolean;
};
export function selectWallDraft<T>(
  previous: WallDraft<T> | null, owner: object, communityId: string,
  fingerprint: string, attachments: readonly T[], newId: () => string,
): WallDraft<T> {
  if (previous && previous.owner === owner && previous.communityId === communityId) {
    const same = previous.fingerprint === fingerprint &&
      previous.attachments.length === attachments.length &&
      previous.attachments.every((item, index) => item === attachments[index]);
    if (same) return previous;
    if (previous.commitStarted) throw new Error('Confirme a publicação anterior antes de alterar o rascunho.');
  }
  return { owner, communityId, fingerprint, attachments: [...attachments],
    uploads: attachments.map(() => ({ id: newId(), started: false })),
    postId: 'wall_' + newId(), commitStarted: false };
}

export async function resolveWallUploads<T>(
  draft: WallDraft<T>, assertCurrent: () => void,
  upload: (item: T, attempt: WallUploadAttempt) => Promise<string>,
): Promise<string[]> {
  if (draft.commitStarted) {
    assertCurrent();
    const urls = draft.uploads.map(item => item.url);
    if (urls.some(url => !url)) throw new Error('Anexos da tentativa anterior indisponíveis.');
    return urls as string[];
  }
  const urls: string[] = [];
  for (const [index, item] of draft.attachments.entries()) {
    assertCurrent();
    const attempt = draft.uploads[index];
    // Revalidate the scope/authorization in the upload adapter even on retry.
    const url = await upload(item, attempt);
    assertCurrent();
    attempt.url = url;
    urls.push(url);
  }
  return urls;
}
