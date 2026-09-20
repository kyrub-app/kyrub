export const MERCADO_PAGO_PLATFORM_PROVIDER_ID = 'mercado_pago' as const;
export const MERCADO_PAGO_PLATFORM_ENVIRONMENT = 'production' as const;

export interface MercadoPagoPlatformOAuthInput {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface MercadoPagoPlatformOAuthStatus {
  configured: boolean;
  clientIdLast4?: string;
  clientSecretLast4?: string;
  redirectUriConfigured: boolean;
}

const clean = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';

export const assertMercadoPagoPlatformOAuthInput = (
  input: Partial<MercadoPagoPlatformOAuthInput>
): MercadoPagoPlatformOAuthInput => {
  const clientId = clean(input.clientId);
  const clientSecret = clean(input.clientSecret);
  const redirectUri = clean(input.redirectUri);

  if (!clientId) throw new Error('MERCADO_PAGO_CLIENT_ID_REQUIRED');
  if (!clientSecret) throw new Error('MERCADO_PAGO_CLIENT_SECRET_REQUIRED');
  if (!/^https:\/\//i.test(redirectUri)) {
    throw new Error('MERCADO_PAGO_REDIRECT_URI_HTTPS_REQUIRED');
  }
  const parsed = new URL(redirectUri);
  if (!parsed.pathname.endsWith('/api/store-connections/mercado-pago/callback')) {
    throw new Error('MERCADO_PAGO_REDIRECT_URI_CALLBACK_INVALID');
  }
  if (
    clientId.length > 256 ||
    clientSecret.length > 4096 ||
    redirectUri.length > 2048
  ) {
    throw new Error('MERCADO_PAGO_OAUTH_CREDENTIAL_TOO_LARGE');
  }

  return { clientId, clientSecret, redirectUri };
};
