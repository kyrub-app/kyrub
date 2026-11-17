import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

export type SocialReportReason = 'spam' | 'abuse' | 'fraud' | 'unsafe' | 'other';
export type SocialReportOutcome = 'submitted' | 'already_reported';

const validId = (value: string, max: number): boolean =>
  Boolean(value && value.length <= max && !value.includes('/'));

async function saveReportOnce(
  collection: 'social_post_reports' | 'social_user_reports',
  reportId: string,
  payload: Record<string, unknown>
): Promise<SocialReportOutcome> {
  const reference = doc(db, collection, reportId);
  if ((await getDoc(reference)).exists()) return 'already_reported';
  try {
    await setDoc(reference, { ...payload, createdAt: serverTimestamp() });
    return 'submitted';
  } catch (error) {
    // A concurrent tab may have submitted the same immutable report first.
    try { if ((await getDoc(reference)).exists()) return 'already_reported'; }
    catch { /* preserve the original failure */ }
    throw error;
  }
}

export async function submitSocialPostReport(
  postId: string,
  reason: SocialReportReason
): Promise<SocialReportOutcome> {
  const user = auth.currentUser;
  if (!user) throw new Error('AUTH_REQUIRED');
  if (!validId(postId, 500) || !['spam', 'abuse', 'fraud', 'unsafe', 'other'].includes(reason)) {
    throw new Error('REPORT_INPUT_INVALID');
  }
  const post = await getDoc(doc(db, 'social_posts', postId));
  if (!post.exists()) throw new Error('POST_NOT_FOUND');
  const authorId = post.data().authorId;
  if (typeof authorId !== 'string' || !authorId || authorId === user.uid) throw new Error('REPORT_TARGET_INVALID');
  const reportId = `${postId}__${user.uid}`;
  return saveReportOnce('social_post_reports', reportId, {
    reportId, postId, reporterId: user.uid, authorId, reason, status: 'pending',
  });
}

export async function submitSocialUserReport(
  targetUserId: string,
  reason: string
): Promise<SocialReportOutcome> {
  const user = auth.currentUser;
  if (!user) throw new Error('AUTH_REQUIRED');
  const normalizedReason = reason.trim();
  if (!validId(targetUserId, 128) || targetUserId === user.uid
      || normalizedReason.length < 3 || normalizedReason.length > 500) {
    throw new Error('REPORT_INPUT_INVALID');
  }
  const reportId = `${targetUserId}__${user.uid}`;
  return saveReportOnce('social_user_reports', reportId, {
    reportId, targetUserId, reporterId: user.uid, reason: normalizedReason, status: 'pending',
  });
}
