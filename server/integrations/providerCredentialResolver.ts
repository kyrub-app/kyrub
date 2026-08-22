import type { KyrubIntegrationEnvironment } from '../../shared/integrationCredentials.js';
import { resolvePlatformCredentials } from './platformCredentialStore.js';

export type MercadoPagoCredentialAuthority = 'vault_v1' | 'environment' | 'none';

export interface ResolvedMercadoPagoCredentials {
  accessToken: string;
  webhookSecret: string;
  authority: MercadoPagoCredentialAuthority;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const environmentFallback = (): ResolvedMercadoPagoCredentials => {
  const accessToken = clean(process.env.MERCADO_PAGO_ACCESS_TOKEN);
  const webhookSecret = clean(process.env.MERCADO_PAGO_WEBHOOK_SECRET);
  return {
    accessToken,
    webhookSecret,
    authority: accessToken || webhookSecret ? 'environment' : 'none',
  };
};

export const resolveMercadoPagoCredentials = async (
  environment: KyrubIntegrationEnvironment = 'production'
): Promise<ResolvedMercadoPagoCredentials> => {
  try {
    const stored = await resolvePlatformCredentials('mercado_pago', environment);
    const accessToken = clean(stored?.access_token);
    const webhookSecret = clean(stored?.webhook_secret);
    if (accessToken || webhookSecret) {
      return {
        accessToken,
        webhookSecret,
        authority: 'vault_v1',
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/INTEGRATION_MASTER_KEY|PLATFORM_CREDENTIAL/i.test(message)) throw error;
  }

  return environmentFallback();
};

export const resolveMercadoPagoAccessToken = async (): Promise<string> =>
  (await resolveMercadoPagoCredentials()).accessToken;

export const resolveMercadoPagoWebhookSecret = async (): Promise<string> =>
  (await resolveMercadoPagoCredentials()).webhookSecret;
