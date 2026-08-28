import { FieldValue } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from './ai/consultantAuth.js';
import { adminDb } from './firebaseAdmin.js';

export type CrmCampaignTransportResult = {
  status: number;
  body: Record<string, unknown>;
};

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const validSegment = (value: unknown): value is 'new' | 'recurring' | 'vip' | 'inactive' =>
  value === 'new' || value === 'recurring' || value === 'vip' || value === 'inactive';

const validBenefitType = (value: unknown): value is 'discount' | 'voucher' | 'free_product' =>
  value === 'discount' || value === 'voucher' || value === 'free_product';

export const executeCrmCampaignTransport = async (
  authorization: string,
  rawBody: unknown
): Promise<CrmCampaignTransportResult> => {
  const body = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
    ? rawBody as Record<string, unknown>
    : {};
  const operation = clean(body.operation) || 'create';

  // Reuse the existing authenticated action-execute transport while the
  // project is constrained by the Vercel Hobby serverless-function budget.
  // Order business logic stays isolated in its own server service.
  if (operation === 'create_attendance_order') {
    const attendance = await import('./orders/customerAttendanceOrderService.js');
    return attendance.createAuthorizedCustomerAttendanceOrder(
      authorization,
      body
    );
  }

  const token = bearerToken(authorization);
  if (!token) {
    return {
      status: 401,
      body: { error: 'Entre novamente para publicar a campanha.', code: 'AUTH_REQUIRED' },
    };
  }

  const identity = await verifyFirebaseIdToken(token);
  const storeId = identity.uid.trim();

  if (operation === 'create') {
    if (!validSegment(body.segment) || !validBenefitType(body.type)) {
      return {
        status: 400,
        body: { error: 'Segmento ou benefício inválido.', code: 'INVALID_CAMPAIGN' },
      };
    }
    const title = clean(body.title);
    if (!title || title.length > 180) {
      return {
        status: 400,
        body: { error: 'Informe um título válido para a campanha.', code: 'INVALID_CAMPAIGN_TITLE' },
      };
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
      return {
        status: 400,
        body: { error: 'Público ou valor da campanha inválido.', code: 'INVALID_CAMPAIGN_AUDIENCE' },
      };
    }
    const startsAt = clean(body.startsAt);
    const endsAt = clean(body.endsAt);
    if (startsAt && endsAt && endsAt < startsAt) {
      return {
        status: 400,
        body: { error: 'O fim da campanha não pode ser anterior ao início.', code: 'INVALID_CAMPAIGN_WINDOW' },
      };
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
    return { status: 201, body: { campaignId: reference.id } };
  }

  if (operation === 'finalize') {
    const campaignId = clean(body.campaignId);
    const notifiedRecipientCount = Number(body.notifiedRecipientCount);
    if (
      !/^[a-zA-Z0-9_-]{1,128}$/.test(campaignId) ||
      !Number.isInteger(notifiedRecipientCount) ||
      notifiedRecipientCount < 0
    ) {
      return {
        status: 400,
        body: { error: 'Finalização de campanha inválida.', code: 'INVALID_CAMPAIGN_FINALIZATION' },
      };
    }
    const reference = adminDb.doc(`storeCrmCampaigns/${storeId}/campaigns/${campaignId}`);
    const snapshot = await reference.get();
    if (!snapshot.exists || snapshot.data()?.storeId !== storeId) {
      return {
        status: 404,
        body: { error: 'Campanha não encontrada.', code: 'CAMPAIGN_NOT_FOUND' },
      };
    }
    const expectedRecipients = Number(snapshot.data()?.recipientCount) || 0;
    if (notifiedRecipientCount > expectedRecipients) {
      return {
        status: 400,
        body: { error: 'Quantidade de destinatários inválida.', code: 'INVALID_CAMPAIGN_FINALIZATION' },
      };
    }
    const now = new Date().toISOString();
    const status = notifiedRecipientCount === expectedRecipients ? 'published' : 'partial';
    await reference.set({
      notifiedRecipientCount,
      status,
      updatedAt: now,
      publishedAt: now,
      recordedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { status: 200, body: { campaignId, status } };
  }

  return {
    status: 400,
    body: { error: 'Operação de campanha inválida.', code: 'INVALID_OPERATION' },
  };
};
