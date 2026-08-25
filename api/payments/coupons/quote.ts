type HeaderValue = string | string[] | undefined;

type RequestLike = {
  method?: string;
  headers: Record<string, HeaderValue>;
  body?: unknown;
};

type ResponseLike = {
  setHeader(name: string, value: string): void;
  status(code: number): ResponseLike;
  json(body: unknown): void;
};

const headerValue = (value: HeaderValue): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

export default async function handler(
  request: RequestLike,
  response: ResponseLike
): Promise<void> {
  response.setHeader('cache-control', 'no-store, max-age=0');
  response.setHeader('content-type', 'application/json; charset=utf-8');

  if ((request.method ?? 'GET').toUpperCase() !== 'POST') {
    response.status(405).json({ error: 'Método não permitido.' });
    return;
  }

  try {
    const authorization = headerValue(
      request.headers.authorization ?? request.headers.Authorization
    );
    const token = bearerToken(authorization);
    if (!token) {
      response.status(401).json({ error: 'Faça login novamente.' });
      return;
    }

    const [{ verifyFirebaseIdToken }, { adminDb }, promotions, promotionUtils] =
      await Promise.all([
        import('../../../server/ai/consultantAuth.js'),
        import('../../../server/firebaseAdmin.js'),
        import('../../../server/payments/storePromotionService.js'),
        import('../../../src/utils/storePromotions.js'),
      ]);
    const identity = await verifyFirebaseIdToken(token);
    const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
      ? request.body as Record<string, unknown>
      : {};
    const storeId = clean(body.storeId);
    const couponCode = promotionUtils.normalizePromotionCode(body.couponCode);
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(storeId) || !couponCode) {
      response.status(400).json({ error: 'Revise os dados do cupom.' });
      return;
    }

    const tenantSnapshot = await adminDb.doc(`tenants/${storeId}`).get();
    const tenant = tenantSnapshot.data() as Record<string, unknown> | undefined;
    if (!tenantSnapshot.exists || tenant?.publicationStatus !== 'published') {
      response.status(404).json({ error: 'A loja não está disponível.' });
      return;
    }
    const catalog = Array.isArray(tenant?.publicProducts) ? tenant.publicProducts : [];
    const productMap = new Map<string, { price: number }>();
    for (const candidate of catalog) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
      const product = candidate as Record<string, unknown>;
      const id = clean(product.id);
      const price = typeof product.price === 'number' && Number.isFinite(product.price)
        ? Math.round(product.price * 100) / 100
        : -1;
      if (id && price >= 0) {
        productMap.set(id, {
          price: product.isComplimentary === true ? 0 : price,
        });
      }
    }

    if (!Array.isArray(body.items) || body.items.length === 0) {
      response.status(400).json({ error: 'Seu carrinho está vazio.' });
      return;
    }
    const lines = body.items.map(candidate => {
      const item = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
        ? candidate as Record<string, unknown>
        : {};
      const productId = clean(item.productId);
      const quantity = item.quantity;
      const product = productMap.get(productId);
      if (!product || !Number.isInteger(quantity) || Number(quantity) <= 0) {
        throw new Error('CHECKOUT_PRODUCT_NOT_AVAILABLE');
      }
      return {
        productId,
        unitPrice: product.price,
        quantity: Number(quantity),
      };
    });

    const resolved = await promotions.resolveStorePromotionForCheckout({
      storeId,
      buyerId: identity.uid,
      couponCode,
      lines,
    });
    response.status(200).json(resolved.quote);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/id-token|expired|revoked|AUTH_REQUIRED/i.test(message)) {
      response.status(401).json({ error: 'Faça login novamente.' });
      return;
    }
    if (message === 'CHECKOUT_PRODUCT_NOT_AVAILABLE') {
      response.status(409).json({
        error: 'Um item do carrinho não está mais disponível. Revise o carrinho.',
      });
      return;
    }
    if (message === 'CHECKOUT_COUPON_NOT_FOUND') {
      response.status(404).json({ error: 'Cupom não encontrado nesta loja.' });
      return;
    }
    if (message === 'CHECKOUT_COUPON_NOT_AVAILABLE') {
      response.status(409).json({ error: 'Este cupom não está mais disponível.' });
      return;
    }
    if (message === 'CHECKOUT_COUPON_NOT_ELIGIBLE') {
      response.status(403).json({ error: 'Este cupom não está disponível para este perfil.' });
      return;
    }
    if (message === 'CHECKOUT_COUPON_BUYER_LIMIT_REACHED') {
      response.status(409).json({ error: 'Você já utilizou o limite permitido deste cupom.' });
      return;
    }
    if (message === 'PROMOTION_NOT_APPLICABLE') {
      response.status(409).json({ error: 'O cupom não se aplica aos itens deste carrinho.' });
      return;
    }
    console.error('[Marketplace Coupon Quote]', error);
    response.status(503).json({ error: 'Não foi possível validar o cupom agora.' });
  }
}