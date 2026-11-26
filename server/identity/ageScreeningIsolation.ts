export const ageScreeningProjectId = 'demo-kyrub-onboarding';
export function ageScreeningEmulatorsReady(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === 'test' && env.KYRUB_AGE_SCREENING_EMULATOR === 'true'
    && !env.VERCEL && !env.FIREBASE_SERVICE_ACCOUNT_JSON && !env.GOOGLE_APPLICATION_CREDENTIALS
    && env.GCLOUD_PROJECT === ageScreeningProjectId && env.FIREBASE_PROJECT_ID === ageScreeningProjectId
    && (!env.GOOGLE_CLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT === ageScreeningProjectId)
    && env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099'
    && env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8088';
}
