import {
  doc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { CustomerOrder } from './customerOrders';
import { db } from './firebase';
import {
  getUserPersonalizedBenefitsCollectionPath,
  type PersonalizedBenefitType,
} from './personalizedBenefits';
import { getUserRelationshipNotificationsCollectionPath } from './relationshipNotifications';

export type CrmSegment = 'new' | 'recurring' | 'vip' | 'inactive';

export interface CrmCampaignRecipient {
  buyerId: string;
  buyerEmail: string;
  buyerName: string;
  segment: CrmSegment;
}

export interface CrmSegmentCampaignDraft {
  segment: CrmSegment;
  title: string;
  description: string;
  type: PersonalizedBenefitType;
  value: number;
  productName: string;
  code: string;
  startsAt: string;
  endsAt: string;
}

const normalizeEmail = (value: string): string =>
  value.trim().toLocaleLowerCase('pt-BR');

const validTime = (value: string): number => {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const isCommercialOrder = (order: CustomerOrder): boolean =>
  order.status !== 'cancelled' && order.status !== 'rejected';

const customerKey = (order: CustomerOrder): string =>
  order.buyerId.trim() || normalizeEmail(order.buyerEmail);

export const getCrmCampaignsCollectionPath = (storeId: string): string =>
  `storeCrmCampaigns/${storeId.trim()}/campaigns`;

export const buildCrmSegmentRecipients = (
  orders: CustomerOrder[],
  now = new Date()
): CrmCampaignRecipient[] => {
  const grouped = new Map<string, {
    buyerId: string;
    buyerEmail: string;
    buyerName: string;
    orderCount: number;
    paidOrderCount: number;
    totalSpent: number;
    lastOrderAt: string;
  }>();

  orders.filter(isCommercialOrder).forEach(order => {
    const key = customerKey(order);
    if (!key) return;
    const current = grouped.get(key) ?? {
      buyerId: order.buyerId.trim(),
      buyerEmail: normalizeEmail(order.buyerEmail),
      buyerName: order.buyerName.trim() || 'Cliente',
      orderCount: 0,
      paidOrderCount: 0,
      totalSpent: 0,
      lastOrderAt: order.createdAt,
    };
    current.buyerId = order.buyerId.trim() || current.buyerId;
    current.buyerEmail = normalizeEmail(order.buyerEmail) || current.buyerEmail;
    current.buyerName = order.buyerName.trim() || current.buyerName;
    current.orderCount += 1;
    if (order.paymentStatus === 'paid') {
      current.paidOrderCount += 1;
      current.totalSpent += order.total;
    }
    if (validTime(order.createdAt) >= validTime(current.lastOrderAt)) {
      current.lastOrderAt = order.createdAt;
    }
    grouped.set(key, current);
  });

  return Array.from(grouped.values()).map(customer => {
    const lastTime = validTime(customer.lastOrderAt);
    const inactiveDays = lastTime
      ? Math.floor((now.getTime() - lastTime) / 86_400_000)
      : 0;
    let segment: CrmSegment = 'new';
    if (customer.totalSpent >= 500 || customer.paidOrderCount >= 8) segment = 'vip';
    else if (inactiveDays >= 60) segment = 'inactive';
    else if (customer.orderCount >= 2) segment = 'recurring';
    return {
      buyerId: customer.buyerId,
      buyerEmail: customer.buyerEmail,
      buyerName: customer.buyerName,
      segment,
    };
  });
};

const safeIdentity = (recipient: CrmCampaignRecipient): string =>
  recipient.buyerId
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 72);

const campaignApi = async (
  user: Pick<User, 'getIdToken'>,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const token = await user.getIdToken();
  const response = await fetch('/api/crm-campaign', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'Não foi possível registrar a campanha.'
    );
  }
  return payload;
};

export const createCrmSegmentCampaign = async (
  user: Pick<User, 'uid' | 'getIdToken'>,
  draft: CrmSegmentCampaignDraft,
  recipients: CrmCampaignRecipient[]
): Promise<{ campaignId: string; recipientCount: number; notifiedRecipientCount: number }> => {
  const storeId = user.uid.trim();
  if (!storeId) throw new Error('Loja não identificada.');
  if (!draft.title.trim()) throw new Error('Informe o título da campanha.');
  if (draft.startsAt && draft.endsAt && draft.endsAt < draft.startsAt) {
    throw new Error('O fim da campanha não pode ser anterior ao início.');
  }

  const segmentAudience = recipients.filter(item => item.segment === draft.segment);
  if (segmentAudience.length === 0) {
    throw new Error('Este segmento não possui clientes elegíveis agora.');
  }
  const audience = segmentAudience.filter(item => item.buyerId.trim());
  if (audience.length === 0) {
    throw new Error('Este segmento ainda não possui clientes com conta Kyrub para receber benefícios privados.');
  }

  const normalizedCode = draft.code.trim().toLocaleUpperCase('pt-BR');
  const campaignPayload = await campaignApi(user, {
    operation: 'create',
    segment: draft.segment,
    title: draft.title.trim(),
    description: draft.description.trim(),
    type: draft.type,
    value: Math.max(0, Number(draft.value) || 0),
    productName: draft.type === 'free_product' ? draft.productName.trim() : '',
    code: normalizedCode,
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    segmentRecipientCount: segmentAudience.length,
    recipientCount: audience.length,
  });
  const campaignId = typeof campaignPayload.campaignId === 'string'
    ? campaignPayload.campaignId.trim()
    : '';
  if (!campaignId) throw new Error('A campanha não recebeu uma identificação válida.');

  const now = new Date().toISOString();
  const recipientWrites = audience.map(recipient => {
    const buyerId = recipient.buyerId.trim();
    const identity = safeIdentity(recipient);
    const benefitId = `campaign-${campaignId}-${identity}`;
    const notificationId = `crm-campaign-${campaignId}-${identity}`;
    return (batch: ReturnType<typeof writeBatch>) => {
      const benefitRef = doc(
        db,
        getUserPersonalizedBenefitsCollectionPath(buyerId),
        benefitId
      );
      batch.set(benefitRef, {
        id: benefitId,
        storeId,
        buyerId,
        buyerEmail: recipient.buyerEmail,
        title: draft.title.trim(),
        description: draft.description.trim(),
        type: draft.type,
        value: Math.max(0, Number(draft.value) || 0),
        productName: draft.type === 'free_product' ? draft.productName.trim() : '',
        code: normalizedCode,
        startsAt: draft.startsAt,
        endsAt: draft.endsAt,
        active: true,
        campaignId,
        audienceSegment: draft.segment,
        createdAt: now,
        updatedAt: now,
        recordedAt: serverTimestamp(),
        schemaVersion: 2,
      });

      const notificationRef = doc(
        db,
        getUserRelationshipNotificationsCollectionPath(buyerId),
        notificationId
      );
      batch.set(notificationRef, {
        id: notificationId,
        kind: 'relationship',
        recipientId: buyerId,
        senderStoreId: storeId,
        title: draft.title.trim(),
        body: draft.description.trim() || 'Você recebeu um novo benefício desta loja.',
        campaignId,
        benefitId,
        createdAt: now,
        readAt: '',
        recordedAt: serverTimestamp(),
        schemaVersion: 1,
      });
    };
  });

  let notifiedRecipientCount = 0;
  try {
    // Two Firestore documents per recipient. 225 recipients keeps each batch under 500 writes.
    for (let index = 0; index < recipientWrites.length; index += 225) {
      const batch = writeBatch(db);
      const slice = recipientWrites.slice(index, index + 225);
      slice.forEach(apply => apply(batch));
      await batch.commit();
      notifiedRecipientCount += slice.length;
    }
  } catch (error) {
    await campaignApi(user, {
      operation: 'finalize',
      campaignId,
      notifiedRecipientCount,
    }).catch(() => undefined);
    throw error;
  }

  await campaignApi(user, {
    operation: 'finalize',
    campaignId,
    notifiedRecipientCount,
  });

  return {
    campaignId,
    recipientCount: audience.length,
    notifiedRecipientCount,
  };
};
