import handleConsultorKyrub, { maxDuration } from './consultor-kyrub.js';

type HeaderValue = string | string[] | undefined;

type ForwardedRequest = {
  method?: string;
  headers?: Record<string, HeaderValue>;
  body?: unknown;
};

type ForwardedResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): ForwardedResponse;
  json(body: unknown): void;
};

export { maxDuration };

export default async function handler(
  request: ForwardedRequest,
  response: ForwardedResponse
): Promise<void> {
  const stableRequest = {
    method: request.method,
    headers: request.headers ?? {},
    body: request.body,
  };

  await handleConsultorKyrub(stableRequest, response);
}
