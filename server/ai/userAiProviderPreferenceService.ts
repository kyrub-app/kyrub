import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from './consultantAuth.js';
import {
  UserAiProviderCredentialError,
  type SupportedUserAiProvider,
} from './userAiProviderCredentialService.js';
import { adminDb } from '../firebaseAdmin.js';

export type UserAiProviderPreferenceMetadata = {
  preferredProvider: SupportedUserAiProvider | null;
  updatedAt?: string;
};

type UserAiProviderPreferenceDocument = {
  schemaVersion: 1;
  uid: string;
  preferredProvider: SupportedUserAiProvider | null;
  updatedAt?: Timestamp;
};

const supportedProviders = new Set<SupportedUserAiProvider>([
  'google-gemini',
  'openai',
  'anthropic',
]);

const preferencePath = (uid: string): string =>
  `users/${uid}/server_private_ai_config/routing`;

const credentialPath = (
  uid: string,
  provider: SupportedUserAiProvider
): string => `users/${uid}/server_private_ai/${provider}`;

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization.trim())?.[1]?.trim() ?? '';

const authenticatedUid = async (authorization: string): Promise<string> => {
  const token = bearerToken(authorization);
  if (!token) {
    throw new UserAiProviderCredentialError(
      401,
      'AUTH_REQUIRED',
      'Faça login novamente para configurar sua IA.'
    );
  }
  const user = await verifyFirebaseIdToken(token);
  return user.uid;
};

const normalizePreference = (
  value: unknown
): SupportedUserAiProvider | null => {
  if (value === null || value === undefined || value === '') return null;
  if (
    typeof value === 'string' &&
    supportedProviders.has(value as SupportedUserAiProvider)
  ) {
    return value as SupportedUserAiProvider;
  }
  throw new UserAiProviderCredentialError(
    400,
    'AI_PROVIDER_UNSUPPORTED',
    'Este provedor de IA ainda não é suportado para conexão direta.'
  );
};

const isoTimestamp = (value: unknown): string | undefined =>
  value instanceof Timestamp ? value.toDate().toISOString() : undefined;

export const loadUserAiProviderPreference = async (
  uid: string
): Promise<SupportedUserAiProvider | null> => {
  const cleanUid = uid.trim();
  if (!cleanUid) return null;
  const snapshot = await adminDb.doc(preferencePath(cleanUid)).get();
  if (!snapshot.exists) return null;
  const preferredProvider = snapshot.data()?.preferredProvider;
  return typeof preferredProvider === 'string' &&
    supportedProviders.has(preferredProvider as SupportedUserAiProvider)
    ? preferredProvider as SupportedUserAiProvider
    : null;
};

export const getAuthorizedUserAiProviderPreference = async (
  authorization: string
): Promise<UserAiProviderPreferenceMetadata> => {
  const uid = await authenticatedUid(authorization);
  const snapshot = await adminDb.doc(preferencePath(uid)).get();
  if (!snapshot.exists) return { preferredProvider: null };
  const data = snapshot.data() as Partial<UserAiProviderPreferenceDocument>;
  const preferredProvider =
    typeof data.preferredProvider === 'string' &&
    supportedProviders.has(data.preferredProvider as SupportedUserAiProvider)
      ? data.preferredProvider as SupportedUserAiProvider
      : null;
  const updatedAt = isoTimestamp(data.updatedAt);
  return {
    preferredProvider,
    ...(updatedAt ? { updatedAt } : {}),
  };
};

export const saveAuthorizedUserAiProviderPreference = async (
  authorization: string,
  providerValue: unknown
): Promise<UserAiProviderPreferenceMetadata> => {
  const uid = await authenticatedUid(authorization);
  const preferredProvider = normalizePreference(providerValue);
  const reference = adminDb.doc(preferencePath(uid));

  if (preferredProvider) {
    const credential = await adminDb
      .doc(credentialPath(uid, preferredProvider))
      .get();
    if (!credential.exists || credential.data()?.status !== 'available') {
      throw new UserAiProviderCredentialError(
        409,
        'AI_PROVIDER_NOT_AVAILABLE',
        'Teste e valide este provedor antes de defini-lo como preferido.'
      );
    }
  }

  await reference.set(
    {
      schemaVersion: 1,
      uid,
      preferredProvider,
      updatedAt: FieldValue.serverTimestamp(),
    } satisfies Omit<UserAiProviderPreferenceDocument, 'updatedAt'> & {
      updatedAt: FieldValue;
    },
    { merge: true }
  );

  return {
    preferredProvider,
    updatedAt: new Date().toISOString(),
  };
};
