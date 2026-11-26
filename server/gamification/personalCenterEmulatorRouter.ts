import express from 'express';
import { adminAuth, adminDb, getFirebaseAdminProjectId } from '../firebaseAdmin.js';
import { listUserNotifications } from '../notifications/userNotificationService.js';
import { readPitangaAccount } from './pitangaAccountService.js';
import { readPersonalSemeaduraJourney } from './semeaduraService.js';

const project = 'kyrub-security-test';
export function personalCenterEmulatorsReady(env: NodeJS.ProcessEnv) {
  return env.NODE_ENV === 'test' && env.KYRUB_FIRST_STORE_PUBLICATION_E2E_LOCAL === 'true' &&
    !env.VERCEL && !env.FIREBASE_SERVICE_ACCOUNT_JSON && !env.GOOGLE_APPLICATION_CREDENTIALS &&
    [env.FIREBASE_PROJECT_ID, env.GCLOUD_PROJECT, env.GOOGLE_CLOUD_PROJECT].every(id => id === project) &&
    env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8088' && env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099';
}

/** Same read services as the deployed transports. Identity comes from the local Auth emulator. */
export function createPersonalCenterEmulatorRouter() {
  const router = express.Router();
  router.use(async (req, res, next) => {
    const account = req.method === 'GET' && req.path === '/pitangas';
    const inbox = req.method === 'GET' && req.path === '/notifications';
    const journey = req.method === 'POST' && req.path === '/action-execute' && req.query.transport === 'semeadura'
      && req.body?.action === 'journey';
    if (!account && !inbox && !journey) { next(); return; }
    res.set('Cache-Control','private, no-store');
    if (!personalCenterEmulatorsReady(process.env) || getFirebaseAdminProjectId() !== project ||
        !['::1','127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '') ||
        !/^127\.0\.0\.1(:\d+)?$/.test(req.get('host') || '')) { res.sendStatus(404); return; }
    if ((journey && (Object.keys(req.body).length !== 1 || Object.keys(req.query).length !== 1))
      || (account && Object.keys(req.query).length) || (inbox && Object.keys(req.query).some(k=>k!=='limit'))) {
      res.sendStatus(400); return;
    }
    const token = /^Bearer (\S+)$/i.exec(req.get('authorization') || '')?.[1];
    if (!token) { res.sendStatus(401); return; }
    let uid: string;
    try {
      const identity = await adminAuth.verifyIdToken(token,true);
      if (identity.aud !== project || !identity.uid) throw Error('invalid identity');
      uid = identity.uid;
    } catch { res.sendStatus(401); return; }
    try {
      if (account) res.json(await readPitangaAccount(adminDb,uid));
      else if (journey) res.json({journey: await readPersonalSemeaduraJourney(adminDb,uid)});
      else {
        const limit = Number(req.query.limit ?? 50);
        res.json(await listUserNotifications({recipientUserId:uid,limit:Number.isFinite(limit)?limit:50}));
      }
    } catch { res.sendStatus(503); }
  });
  return router;
}
