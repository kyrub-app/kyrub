import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { SocialReportOutcome, SocialReportReason } from './socialReports';

const validId = (id: string): boolean => /^[a-zA-Z0-9_-]{1,128}$/.test(id);

/**
 * Report a published store review whether or not it was shared in the Praça.
 * Firestore Rules verify the actual review and sender. No automatic sanctions
 * or Pitangas/XP rewards are triggered by a complaint.
 */
export async function submitStoreReviewReport(
  storeId: string,
  reviewId: string,
  reason: SocialReportReason,
): Promise<SocialReportOutcome> {
  const reporter = auth.currentUser;
  if (!reporter) throw new Error('AUTH_REQUIRED');
  if (!validId(storeId) || !validId(reviewId) ||
      !['spam', 'abuse', 'fraud', 'unsafe', 'other'].includes(reason)) {
    throw new Error('INVALID_REPORT_INPUT');
  }
  const review = await getDoc(doc(db, 'store_reviews', storeId, 'reviews', reviewId));
  if (!review.exists() || review.data().status !== 'published') {
    throw new Error('REVIEW_NOT_AVAILABLE');
  }
  const authorId = review.data().authorId;
  if (typeof authorId !== 'string' || authorId === reporter.uid || !validId(authorId)) {
    throw new Error('CANNOT_REPORT_OWN_REVIEW');
  }
  const reportId = `${storeId}__${reviewId}__${reporter.uid}`;
  const reportRef = doc(db, 'store_review_reports', reportId);
  try {
    await setDoc(reportRef, {
      reportId, storeId, reviewId, authorId, reporterId: reporter.uid,
      reason, status: 'pending', createdAt: serverTimestamp(),
    });
    return 'submitted';
  } catch (error) {
    // Avoid pre-reading an absent private report, which is denied by the rules.
    try {
      if ((await getDoc(reportRef)).exists()) return 'already_reported';
    } catch { /* preserve the original write failure */ }
    throw error;
  }
}
