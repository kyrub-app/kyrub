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

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (value: HeaderValue): string => {
  const authorization = Array.isArray(value) ? value[0] ?? '' : value ?? '';
  return /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';
};

const validSegment = (value: unknown): value is 'new' | 'recurring' | 'vip' | 'inactive' =>
  value === 'new' || value === 'recurring' || value === 'vip' || value === 'inactive';

const validBenefitType = (value: unknown): value is 'discount' | 'voucher' | 'free_product' =>
  value === 'discount' || value === 'voucher' || value === 'free_product';

export default async function handler(request: RequestLike, response: ResponseLike): Promise<void> {
  response.setHeader('cache-control', 'no-store, max-age=0');
  response.setHeader('content-type', 'application/json; charset=utf-8');

  if ((request.method ?? 'GET').toUpperCase() !== 'POST') {
    response.status(405).json({ error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
    return;
  }

  try {
    const token = bearerToken(request.headers.authorization ?? request.headers.Authorization);
    if (!token) {
      response.status(401).json({ error: 'Entre novamente para publicar a campanha.', code: 'AUTH_REQUIRED' });
      return;
    }

    const [{ verifyFirebaseIdToken }, { adminDb }, { FieldValue }] = await Promise.all([
      import('../server/ai/consultantAuth.js'),
      import('../server/firebaseAdmin.js'),
      import('firebase-admin/firestore'),
    ]);
    const identity = await verifyFirebaseIdToken(token);
    const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
      ? request.body as Record<string, unknown>
      : {};
    const operation = clean(body.operation) || 'create';
    const storeId = identity.uid.trim();

    if (operation === 'create') {
      if (!validSegment(body.segment) || !validBenefitType(body.type)) {
        response.status(400).json({ error: 'Segmento ou benefício inválido.', code: 'INVALID_CAMPAIGN' });
        return;
      }
      const title = clean(body.title);
      if (!title || title.length > 180) {
        response.status(400).json({ error: 'Informe um título válido para a campanha.', code: 'INVALID_CAMPAIGN_TITLE' });
        return;
      }
      const description = clean(body.description).slice(0, 2000);
      const value = Number(body.value);
      const segmentRecipientCount = Number(body.segmentRecipientCount);
      const recipientCount = Number(body.recipientCount);
      if (
        !Number.isFinite(value) || value < 0 ||
        !Number.isInteger(segmentRecipientCount) || segmentRecipientCount < 0 ||
        !Number.isInteger(recipientCount) || recipientCount < 1 ||
        recipientCount > segmentRecipientCount
      ) {
        response.status(400).json({ error: 'Público ou valor da campanha inválido.', code: 'INVALID_CAMPAIGN_AUDIENCE' });
        return;
      }
      const startsAt = clean(body.startsAt);
      const endsAt = clean(body.endsAt);
      if (startsAt && endsAt && endsAt < startsAt) {
        response.status(400).json({ error: 'O fim da campanha não pode ser anterior ao início.', code: 'INVALID_CAMPAIGN_WINDOW' });
        return;
      }

      const reference = adminDb.collection(`storeCrmCampaigns/${storeId}/campaigns`).doc();
      const now = new Date().toISOString();
      await reference.set({
        id: reference.id,
        storeId,
        segment: body.segment,
        title,
        description,
        type: body.type,
        value,
        productName: body.type === 'free_product' ? clean(body.productName) : '',
        code: clean(body.code).toUpperCase(),
        startsAt,
        endsAt,
        segmentRecipientCount,
        recipientCount,
        notifiedRecipientCount: 0,
        status: 'publishing',
        createdAt: now,
        updatedAt: now,
        recordedAt: FieldValue.serverTimestamp(),
        schemaVersion: 4,
      });
      response.status(201).json({ campaignId: reference.id });
      return;
    }

    if (operation === 'finalize') {
      const campaignId = clean(body.campaignId);
      const notifiedRecipientCount = Number(body.notifiedRecipientCount);
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(campaignId) || !Number.isInteger(notifiedRecipientCount) || notifiedRecipientCount < 0) {
        response.status(400).json({ error: 'Finalização de campanha inválida.', code: 'INVALID_CAMPAIGN_FINALIZATION' });
        return;
      }
      const reference = adminDb.doc(`storeCrmCampaigns/${storeId}/campaigns/${campaignId}`);
      const snapshot = await reference.get();
      if (!snapshot.exists || snapshot.data()?.storeId !== storeId) {
        response.status(404).json({ error: 'Campanha não encontrada.', code: 'CAMPAIGN_NOT_FOUND' });
        return;
      }
      const expectedRecipients = Number(snapshot.data()?.recipientCount) || 0;
      if (notifiedRecipientCount > expectedRecipients) {
        response.status(400).json({ error: 'Quantidade de destinatários inválida.', code: 'INVALID_CAMPAIGN_FINALIZATION' });
        return;
      }
      const now = new Date().toISOString();
      await reference.set({
        notifiedRecipientCount,
        status: notifiedRecipientCount === expectedRecipients ? 'published' : 'partial',
        updatedAt: now,
        publishedAt: now,
        recordedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      response.status(200).json({ campaignId, status: notifiedRecipientCount === expectedRecipients ? 'published' : 'partial' });
      return;
    }

    response.status(400).json({ error: 'Operação de campanha inválida.', code: 'INVALID_OPERATION' });
  } catch (error) {
    console.error('[CRM Campaign]', error);
    response.status(500).json({ error: 'Não foi possível registrar a campanha agora.', code: 'CRM_CAMPAIGN_FAILED' });
  }
}
