import {
  collection,
  doc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { CustomerOrder } from './customerOrders';
import { db } from './firebase';
import {
  getPersonalizedBenefitsCollectionPath,
  type PersonalizedBenefitType,
} from './personalizedBenefits';

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
  `artifacts/${storeId.trim()}/public/data/crmCampaigns`;

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
  (recipient.buyerId || recipient.buyerEmail)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 120);

export const createCrmSegmentCampaign = async (
  user: Pick<User, 'uid'>,
  draft: CrmSegmentCampaignDraft,
  recipients: CrmCampaignRecipient[]
): Promise<{ campaignId: string; recipientCount: number }> => {
  const storeId = user.uid.trim();
  if (!storeId) throw new Error('Loja não identificada.');
  if (!draft.title.trim()) throw new Error('Informe o título da campanha.');
  if (draft.startsAt && draft.endsAt && draft.endsAt < draft.startsAt) {
    throw new Error('O fim da campanha não pode ser anterior ao início.');
  }
  const audience = recipients.filter(item => item.segment === draft.segment);
  if (audience.length === 0) throw new Error('Este segmento não possui clientes elegíveis agora.');

  const campaignRef = doc(collection(db, getCrmCampaignsCollectionPath(storeId)));
  const now = new Date().toISOString();
  const normalizedCode = draft.code.trim().toLocaleUpperCase('pt-BR');
  const benefitCollection = getPersonalizedBenefitsCollectionPath(storeId);

  const writes: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
  writes.push(batch => batch.set(campaignRef, {
    id: campaignRef.id,
    storeId,
    segment: draft.segment,
    title: draft.title.trim(),
    description: draft.description.trim(),
    type: draft.type,
    value: Math.max(0, Number(draft.value) || 0),
    productName: draft.type === 'free_product' ? draft.productName.trim() : '',
    code: normalizedCode,
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    recipientCount: audience.length,
    status: 'published',
    createdAt: now,
    updatedAt: now,
    recordedAt: serverTimestamp(),
    schemaVersion: 1,
  }));

  audience.forEach(recipient => {
    const benefitId = `campaign-${campaignRef.id}-${safeIdentity(recipient)}`;
    const benefitRef = doc(db, benefitCollection, benefitId);
    writes.push(batch => batch.set(benefitRef, {
      id: benefitId,
      storeId,
      buyerId: recipient.buyerId,
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
      campaignId: campaignRef.id,
      audienceSegment: draft.segment,
      createdAt: now,
      updatedAt: now,
      recordedAt: serverTimestamp(),
      schemaVersion: 1,
    }));
  });

  for (let index = 0; index < writes.length; index += 450) {
    const batch = writeBatch(db);
    writes.slice(index, index + 450).forEach(apply => apply(batch));
    await batch.commit();
  }

  return { campaignId: campaignRef.id, recipientCount: audience.length };
};
