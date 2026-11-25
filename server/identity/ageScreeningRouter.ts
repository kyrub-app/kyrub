import express, { type ErrorRequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { getFirebaseAdminProjectId } from '../firebaseAdmin.js';
import { getOwnAgeStatus, submitOwnAgeScreening } from './ageEligibilityService.js';

const projectId = 'demo-kyrub-onboarding';
const loopback = new Set(['::1', '127.0.0.1', '::ffff:127.0.0.1']);
export function ageScreeningEmulatorsReady(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === 'test' && env.KYRUB_AGE_SCREENING_EMULATOR === 'true'
    && !env.VERCEL && !env.FIREBASE_SERVICE_ACCOUNT_JSON && !env.GOOGLE_APPLICATION_CREDENTIALS
    && env.GCLOUD_PROJECT === projectId && env.FIREBASE_PROJECT_ID === projectId
    && (!env.GOOGLE_CLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT === projectId)
    && env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099'
    && env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8088';
}

export function createAgeScreeningRouter() {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!ageScreeningEmulatorsReady(process.env) || !loopback.has(req.socket.remoteAddress || '')
        || !/^127\.0\.0\.1(:\d+)?$/.test(req.get('host') || '')
        || getFirebaseAdminProjectId() !== projectId) {
      res.sendStatus(404);
      return;
    }
    if (req.path !== '/') { res.sendStatus(404); return; }
    if (!['GET', 'POST'].includes(req.method)) { res.set('Allow', 'GET, POST').sendStatus(405); return; }
    next();
  });
  router.use(rateLimit({windowMs: 60000, limit: 30, keyGenerator: () => 'local-screening', standardHeaders: 'draft-7', legacyHeaders: false}));
  router.get('/', async (req, res, next) => {
    try { res.json(await getOwnAgeStatus(req.get('authorization') || '')); }
    catch (error) { next(error); }
  });
  router.post('/', express.json({limit: '512b'}), async (req, res, next) => {
    if (!req.is('application/json')) { res.sendStatus(415); return; }
    try { res.json(await submitOwnAgeScreening(req.get('authorization') || '', req.body)); }
    catch (error) { next(error); }
  });
  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    const reason = error instanceof Error ? error.message : '';
    const badInput = ['AGE_INPUT_INVALID','INVALID_DATE','FUTURE_BIRTH_DATE','DECLARATION_REQUIRED'];
    const authErrors = ['auth/id-token-expired','auth/id-token-revoked','auth/argument-error','auth/invalid-id-token','auth/user-not-found','auth/user-disabled'];
    if (reason === 'AGE_AUTH_REQUIRED' || authErrors.includes(error?.code)) res.sendStatus(401);
    else if (badInput.includes(reason) || error?.type === 'entity.parse.failed') res.sendStatus(400);
    else if (error?.type === 'entity.too.large') res.sendStatus(413);
    else res.sendStatus(503);
  };
  router.use(handleError);
  return router;
}
