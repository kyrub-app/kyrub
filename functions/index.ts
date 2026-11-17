import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { runWith } from 'firebase-functions/v1';
import { handleWelcomeAuthCreated } from '../server/gamification/welcomeAuthCreatedHandler.js';

// A Google federated account is created by its first authenticated sign-in.
// No callable/HTTP endpoint can manufacture this lifecycle event.
export const welcome100PitangasOnAuthCreate = runWith({ failurePolicy: true }).auth.user().onCreate(async (user, context) => {
  const app = getApps()[0] ?? initializeApp();
  const projectId = app.options.projectId || process.env.GCLOUD_PROJECT || '';
  await handleWelcomeAuthCreated(getFirestore(app), getAuth(app), user, {
    eventId: context.eventId, projectId,
  });
});
