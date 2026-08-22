export interface KyrubVaultAccessTokenProvider {
  getAccessToken(): Promise<string>;
}

export interface KyrubVaultReadResult {
  value: string;
  version: string;
  resourceName: string;
}

export interface KyrubVaultWriteResult {
  version: string;
  resourceName: string;
}

type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

const SECRET_MANAGER_API = 'https://secretmanager.googleapis.com/v1';
const MAX_SECRET_BYTES = 64 * 1024;
const GSM_REF = /^gsm:\/\/projects\/([A-Za-z0-9._:-]+)\/secrets\/([A-Za-z0-9_-]+)$/;

const nonEmpty = (value: string, label: string): string => {
  if (!value.trim()) throw new Error(`${label} é obrigatório.`);
  return value;
};

export interface ParsedGoogleSecretManagerRef {
  projectId: string;
  secretId: string;
  parent: string;
}

export const parseGoogleSecretManagerRef = (
  secretRef: string
): ParsedGoogleSecretManagerRef => {
  const match = GSM_REF.exec(secretRef.trim());
  if (!match) {
    throw new Error('KYRUB_VAULT_SECRET_REF_INVALID');
  }
  const projectId = match[1];
  const secretId = match[2];
  return {
    projectId,
    secretId,
    parent: `projects/${projectId}/secrets/${secretId}`,
  };
};

const versionFromResourceName = (name: string): string => {
  const match = /\/versions\/([^/]+)$/.exec(name);
  if (!match?.[1]) throw new Error('KYRUB_VAULT_VERSION_INVALID');
  return match[1];
};

const bearerHeaders = async (
  tokenProvider: KyrubVaultAccessTokenProvider
): Promise<Record<string, string>> => {
  const token = nonEmpty(await tokenProvider.getAccessToken(), 'vault.accessToken');
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
  };
};

const throwHttpError = (operation: 'access' | 'add-version', status: number): never => {
  throw new Error(`KYRUB_VAULT_${operation === 'access' ? 'ACCESS' : 'WRITE'}_FAILED:${status}`);
};

export class GoogleSecretManagerVault {
  constructor(
    private readonly tokenProvider: KyrubVaultAccessTokenProvider,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  async readLatest(secretRef: string): Promise<KyrubVaultReadResult> {
    const ref = parseGoogleSecretManagerRef(secretRef);
    const headers = await bearerHeaders(this.tokenProvider);
    const response = await this.fetchImpl(
      `${SECRET_MANAGER_API}/${ref.parent}/versions/latest:access`,
      { method: 'GET', headers }
    );
    if (!response.ok) throwHttpError('access', response.status);

    const payload = await response.json() as {
      name?: unknown;
      payload?: { data?: unknown };
    };
    const resourceName = typeof payload.name === 'string' ? payload.name.trim() : '';
    const encoded = typeof payload.payload?.data === 'string'
      ? payload.payload.data
      : '';
    if (!resourceName || !encoded) throw new Error('KYRUB_VAULT_ACCESS_RESPONSE_INVALID');

    return {
      value: Buffer.from(encoded, 'base64').toString('utf8'),
      version: versionFromResourceName(resourceName),
      resourceName,
    };
  }

  async addVersion(secretRef: string, value: string): Promise<KyrubVaultWriteResult> {
    const ref = parseGoogleSecretManagerRef(secretRef);
    if (Buffer.byteLength(value, 'utf8') === 0) {
      throw new Error('KYRUB_VAULT_SECRET_VALUE_REQUIRED');
    }
    if (Buffer.byteLength(value, 'utf8') > MAX_SECRET_BYTES) {
      throw new Error('KYRUB_VAULT_SECRET_VALUE_TOO_LARGE');
    }

    const headers = {
      ...(await bearerHeaders(this.tokenProvider)),
      'content-type': 'application/json; charset=utf-8',
    };
    const response = await this.fetchImpl(
      `${SECRET_MANAGER_API}/${ref.parent}:addVersion`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          payload: {
            data: Buffer.from(value, 'utf8').toString('base64'),
          },
        }),
      }
    );
    if (!response.ok) throwHttpError('add-version', response.status);

    const payload = await response.json() as { name?: unknown };
    const resourceName = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!resourceName) throw new Error('KYRUB_VAULT_WRITE_RESPONSE_INVALID');

    return {
      version: versionFromResourceName(resourceName),
      resourceName,
    };
  }
}
