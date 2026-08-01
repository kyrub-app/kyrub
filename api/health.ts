type RequestLike = {
  method?: string;
};

type ResponseLike = {
  status: (code: number) => ResponseLike;
  json: (value: unknown) => void;
  setHeader?: (name: string, value: string) => void;
};

export type KyrubHealthPayload = {
  status: 'ok';
  service: 'kyrub';
  environment: string;
  release: string;
  timestamp: string;
  capabilities: {
    kyrubia: 'configured' | 'unconfigured';
  };
};

const releaseIdentifier = (): string =>
  process.env.KYRUB_RELEASE?.trim()
  || process.env.VERCEL_GIT_COMMIT_SHA?.trim().slice(0, 12)
  || process.env.npm_package_version?.trim()
  || 'development';

export const buildKyrubHealthPayload = (
  now: Date = new Date()
): KyrubHealthPayload => ({
  status: 'ok',
  service: 'kyrub',
  environment: process.env.VERCEL_ENV?.trim()
    || process.env.NODE_ENV?.trim()
    || 'development',
  release: releaseIdentifier(),
  timestamp: now.toISOString(),
  capabilities: {
    kyrubia: process.env.GEMINI_API_KEY?.trim()
      ? 'configured'
      : 'unconfigured',
  },
});

export default function handler(
  request: RequestLike,
  response: ResponseLike
): void {
  const method = request.method?.toUpperCase() || 'GET';

  response.setHeader?.('Cache-Control', 'no-store, max-age=0');
  response.setHeader?.('Content-Type', 'application/json; charset=utf-8');

  if (method !== 'GET') {
    response.status(405).json({
      error: 'Método não permitido.',
      code: 'METHOD_NOT_ALLOWED',
    });
    return;
  }

  response.status(200).json(buildKyrubHealthPayload());
}
