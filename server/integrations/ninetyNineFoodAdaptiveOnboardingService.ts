import { createHash } from 'node:crypto';
import { resolvePlatformCredentials } from './platformCredentialStore.js';

const PROVIDER = '99food' as const;
const DISCOVERY_TIMEOUT_MS = 10_000;
const MAX_DISCOVERY_BYTES = 1_000_000;

type Environment = 'sandbox' | 'production';

export type NinetyNineFoodOnboardingMode =
  | 'platform_managed'
  | 'authorization_required'
  | 'merchant_credentials_required'
  | 'platform_not_ready'
  | 'provider_contract_unsupported';

export interface NinetyNineFoodOnboardingPlan {
  provider: typeof PROVIDER;
  environment: Environment;
  mode: NinetyNineFoodOnboardingMode;
  platformConfigured: boolean;
  discoveryVerified: boolean;
  merchantMustProvideSecret: boolean;
  merchantCanConnect: boolean;
  supportedGrantTypes: string[];
  clientIdGeneration: string[];
  manifestHash: string;
  message: string;
}

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().slice(0, maximum)
    : '';

const environmentOf = (value: unknown): Environment =>
  value === 'production' ? 'production' : 'sandbox';

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(new Set(value.map(entry => clean(entry, 120)).filter(Boolean)))
    : [];

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const safeBaseUrl = (value: unknown): string => {
  const raw = clean(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return '';
    return parsed.origin;
  } catch {
    return '';
  }
};

const fetchManifest = async (baseUrl: string): Promise<{ text: string; manifest: Record<string, unknown> }> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const response = await fetch(new URL('/.well-known/opendelivery', baseUrl), {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`NINETY_NINE_FOOD_ONBOARDING_DISCOVERY_HTTP_${response.status}`);
    const text = await response.text();
    if (!text || Buffer.byteLength(text, 'utf8') > MAX_DISCOVERY_BYTES) {
      throw new Error('NINETY_NINE_FOOD_ONBOARDING_DISCOVERY_INVALID');
    }
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('NINETY_NINE_FOOD_ONBOARDING_DISCOVERY_INVALID');
    }
    return { text, manifest: parsed as Record<string, unknown> };
  } finally {
    clearTimeout(timer);
  }
};

const unavailable = (environment: Environment, message: string): NinetyNineFoodOnboardingPlan => ({
  provider: PROVIDER,
  environment,
  mode: 'platform_not_ready',
  platformConfigured: false,
  discoveryVerified: false,
  merchantMustProvideSecret: false,
  merchantCanConnect: false,
  supportedGrantTypes: [],
  clientIdGeneration: [],
  manifestHash: '',
  message,
});

export const resolveNinetyNineFoodOnboardingPlan = async (
  environmentValue: unknown
): Promise<NinetyNineFoodOnboardingPlan> => {
  const environment = environmentOf(environmentValue);
  const credentials = await resolvePlatformCredentials(PROVIDER, environment);
  const baseUrl = safeBaseUrl(credentials?.base_url);
  if (!baseUrl || !clean(credentials?.client_id, 500) || !clean(credentials?.client_secret, 2_000)) {
    return unavailable(
      environment,
      'A integração 99Food ainda não foi habilitada pela plataforma Kyrub neste ambiente.'
    );
  }

  let fetched: { text: string; manifest: Record<string, unknown> };
  try {
    fetched = await fetchManifest(baseUrl);
  } catch {
    return {
      ...unavailable(environment, 'A configuração da 99Food existe, mas o contrato público do provedor não pôde ser confirmado agora.'),
      platformConfigured: true,
    };
  }

  const authentication = record(fetched.manifest.authentication);
  const grantTypes = stringArray(authentication.supportedGrantTypes);
  const generation = stringArray(authentication.clientIdGeneration);
  const manifestHash = createHash('sha256').update(fetched.text).digest('hex');
  const clientCredentials = grantTypes.includes('client_credentials');
  const authorizationCode = grantTypes.includes('authorization_code');
  const byApp = generation.includes('by_app');
  const byMerchant = generation.includes('by_merchant');

  if (clientCredentials && byApp) {
    return {
      provider: PROVIDER,
      environment,
      mode: 'platform_managed',
      platformConfigured: true,
      discoveryVerified: true,
      merchantMustProvideSecret: false,
      merchantCanConnect: true,
      supportedGrantTypes: grantTypes,
      clientIdGeneration: generation,
      manifestHash,
      message: 'A 99Food pode ser conectada usando a credencial segura da plataforma Kyrub. Nenhuma chave é exigida da loja.',
    };
  }

  if (authorizationCode) {
    return {
      provider: PROVIDER,
      environment,
      mode: 'authorization_required',
      platformConfigured: true,
      discoveryVerified: true,
      merchantMustProvideSecret: false,
      merchantCanConnect: false,
      supportedGrantTypes: grantTypes,
      clientIdGeneration: generation,
      manifestHash,
      message: 'A 99Food exige autorização da loja. O Kyrub não solicitará uma chave privada ao lojista.',
    };
  }

  if (clientCredentials && byMerchant) {
    return {
      provider: PROVIDER,
      environment,
      mode: 'merchant_credentials_required',
      platformConfigured: true,
      discoveryVerified: true,
      merchantMustProvideSecret: true,
      merchantCanConnect: true,
      supportedGrantTypes: grantTypes,
      clientIdGeneration: generation,
      manifestHash,
      message: 'Este contrato da 99Food exige credencial específica por loja. Os campos seguros serão exibidos somente neste caso.',
    };
  }

  return {
    provider: PROVIDER,
    environment,
    mode: 'provider_contract_unsupported',
    platformConfigured: true,
    discoveryVerified: true,
    merchantMustProvideSecret: false,
    merchantCanConnect: false,
    supportedGrantTypes: grantTypes,
    clientIdGeneration: generation,
    manifestHash,
    message: 'O contrato de autenticação declarado pela 99Food ainda não é suportado pelo Kyrub.',
  };
};

export const resolveNinetyNineFoodPlatformConnectionMaterial = async (environmentValue: unknown): Promise<{
  environment: Environment;
  baseUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
}> => {
  const environment = environmentOf(environmentValue);
  const plan = await resolveNinetyNineFoodOnboardingPlan(environment);
  if (plan.mode !== 'platform_managed') {
    throw new Error('NINETY_NINE_FOOD_PLATFORM_MANAGED_NOT_AVAILABLE');
  }
  const credentials = await resolvePlatformCredentials(PROVIDER, environment);
  const baseUrl = safeBaseUrl(credentials?.base_url);
  const clientId = clean(credentials?.client_id, 500);
  const clientSecret = clean(credentials?.client_secret, 2_000);
  const tokenUrl = safeBaseUrl(credentials?.token_url)
    ? clean(credentials?.token_url)
    : new URL('/oauth/token', `${baseUrl}/`).toString();
  if (!baseUrl || !clientId || !clientSecret) {
    throw new Error('NINETY_NINE_FOOD_PLATFORM_MANAGED_NOT_AVAILABLE');
  }
  return { environment, baseUrl, tokenUrl, clientId, clientSecret };
};
