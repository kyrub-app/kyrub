import { getFirebaseAdminAccessToken } from '../firebaseAdmin.js';
import {
  GoogleSecretManagerVault,
  type KyrubVaultAccessTokenProvider,
} from './googleSecretManagerVault.js';

export interface KyrubCredentialVaultConfig {
  enabled: boolean;
  backend: 'google-secret-manager' | 'disabled';
}

const enabledFromEnvironment = (): boolean =>
  process.env.KYRUB_GOOGLE_SECRET_MANAGER_ENABLED?.trim().toLowerCase() === 'true';

export const kyrubCredentialVaultConfig = (): KyrubCredentialVaultConfig => {
  const enabled = enabledFromEnvironment();
  return {
    enabled,
    backend: enabled ? 'google-secret-manager' : 'disabled',
  };
};

export const createKyrubCredentialVault = (input: {
  tokenProvider?: KyrubVaultAccessTokenProvider;
  fetchImpl?: typeof fetch;
} = {}): GoogleSecretManagerVault => {
  const config = kyrubCredentialVaultConfig();
  if (!config.enabled) {
    throw new Error('KYRUB_CREDENTIAL_VAULT_DISABLED');
  }

  const tokenProvider = input.tokenProvider ?? {
    getAccessToken: getFirebaseAdminAccessToken,
  };

  return new GoogleSecretManagerVault(
    tokenProvider,
    input.fetchImpl
  );
};
