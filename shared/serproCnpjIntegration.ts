export const SERPRO_CNPJ_TOKEN_ENDPOINT = 'https://gateway.apiserpro.serpro.gov.br/token';
export const SERPRO_CNPJ_BASIC_ENDPOINT = 'https://gateway.apiserpro.serpro.gov.br/consulta-cnpj-df/v2/basica';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const credential = (value: unknown, code: string): string => {
  const normalized = clean(value);
  if (!normalized) throw new Error(code);
  if (normalized.length > 4096) throw new Error('SERPRO_CNPJ_CREDENTIAL_TOO_LARGE');
  return normalized;
};

export const assertSerproCnpjCredentials = (input: {
  consumerKey: unknown;
  consumerSecret: unknown;
}): { consumerKey: string; consumerSecret: string } => ({
  consumerKey: credential(input.consumerKey, 'SERPRO_CNPJ_CONSUMER_KEY_REQUIRED'),
  consumerSecret: credential(input.consumerSecret, 'SERPRO_CNPJ_CONSUMER_SECRET_REQUIRED'),
});

export interface SerproCnpjBasicLookupView {
  source: 'serpro_cnpj';
  lookedUpAt: string;
  cnpj: string;
  legalName: string;
  tradeName: string;
  registrationStatus: {
    code: string;
    date: string;
    reason: string;
  };
  primaryCnae: {
    code: string;
    description: string;
  };
  address: {
    street: string;
    number: string;
    complement: string;
    district: string;
    city: string;
    state: string;
    postalCode: string;
    ibgeCityCode: string;
  };
}
