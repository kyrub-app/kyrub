export const MERCADO_LIVRE_PLATFORM_PROVIDER_ID = 'mercado_livre' as const;
export const MERCADO_LIVRE_PLATFORM_ENVIRONMENT = 'production' as const;

export interface MercadoLivrePlatformCredentialInput {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface MercadoLivrePlatformCredentialStatus {
  configured: boolean;
  validated: boolean;
  clientIdLast4?: string;
  clientSecretLast4?: string;
  redirectUriConfigured: boolean;
  lastValidatedAt?: string;
  validationCode?: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

export const assertMercadoLivrePlatformCredentialInput = (
  input: Partial<MercadoLivrePlatformCredentialInput>
): MercadoLivrePlatformCredentialInput => {
  const clientId = clean(input.clientId);
  const clientSecret = clean(input.clientSecret);
  const redirectUri = clean(input.redirectUri);

  if (!clientId) throw new Error('MERCADO_LIVRE_CLIENT_ID_REQUIRED');
  if (!clientSecret) throw new Error('MERCADO_LIVRE_CLIENT_SECRET_REQUIRED');
  if (!/^https:\/\//i.test(redirectUri)) {
    throw new Error('MERCADO_LIVRE_REDIRECT_URI_HTTPS_REQUIRED');
  }
  const parsed = new URL(redirectUri);
  if (!parsed.pathname.endsWith('/api/store-connections/mercado-livre/oauth/callback')) {
    throw new Error('MERCADO_LIVRE_REDIRECT_URI_CALLBACK_INVALID');
  }
  if (clientId.length > 256 || clientSecret.length > 4096 || redirectUri.length > 2048) {
    throw new Error('MERCADO_LIVRE_PLATFORM_CREDENTIAL_TOO_LARGE');
  }

  return { clientId, clientSecret, redirectUri };
};
