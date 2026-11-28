// Only bridge the existing, authenticated handlers. Their local-only gates remain authoritative.
type Surface = 'freelance-workspace' | 'freelance-finance' | 'personal-finance-pix' | 'freelance-financial-review';
type Request = { method?: string; headers: Record<string, string | string[] | undefined>; query?: Record<string, string | string[] | undefined>; body?: unknown };
type Response = { setHeader(name: string, value: string): unknown; status(code: number): { json(body: unknown): unknown } };

export async function handleFreelanceServerlessRequest(surface: Surface, request: Request, response: Response): Promise<void> {
  response.setHeader('Cache-Control', 'private, no-store, max-age=0');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const { transport, ...query } = request.query ?? {};
  if (transport !== surface) {
    response.status(400).json({ code: 'FREELANCE_INVALID_TRANSPORT' });
    return;
  }
  // Strip the routing selector only; retain business query and original credentials/body.
  const forwarded = { method: request.method, headers: request.headers, query, body: request.body };
  try {
    switch (surface) {
      case 'freelance-workspace':
        return await (await import('./freelanceWorkspaceTransport.js')).handleFreelanceWorkspace(forwarded, response);
      case 'freelance-finance':
        return await (await import('./freelanceFinanceTransport.js')).handleFreelanceFinance(forwarded, response);
      case 'personal-finance-pix':
        return await (await import('../payments/personalPixTransport.js')).handlePersonalPix(forwarded, response);
      case 'freelance-financial-review':
        return await (await import('../admin/freelanceFinancialReviewTransport.js')).handleFreelanceFinancialReview(forwarded, response);
      default:
        response.status(400).json({ code: 'FREELANCE_INVALID_TRANSPORT' });
    }
  } catch {
    // Do not leak financial payloads, credentials, or initialization errors.
    response.status(503).json({ code: 'FREELANCE_TRANSPORT_UNAVAILABLE' });
  }
}
