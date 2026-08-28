import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from './firebase';

export type PersonalizedBenefitType = 'discount' | 'voucher' | 'free_product';

export interface PersonalizedBenefit {
  id: string;
  storeId: string;
  buyerId: string;
  buyerEmail: string;
  title: string;
  description: string;
  type: PersonalizedBenefitType;
  value: number;
  productName: string;
  code: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PersonalizedBenefitDraft = Pick<
  PersonalizedBenefit,
  'buyerId' | 'buyerEmail' | 'title' | 'description' | 'type' | 'value' | 'productName' | 'code' | 'startsAt' | 'endsAt' | 'active'
>;

const cleanString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const cleanNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const normalizeEmail = (value: string): string =>
  value.trim().toLocaleLowerCase('pt-BR');

export const getPersonalizedBenefitsCollectionPath = (storeId: string): string =>
  `artifacts/${storeId.trim()}/public/data/personalizedBenefits`;

const parseBenefit = (value: unknown): PersonalizedBenefit | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = cleanString(record.id);
  const storeId = cleanString(record.storeId);
  const title = cleanString(record.title);
  const type = record.type;
  if (!id || !storeId || !title) return null;
  if (type !== 'discount' && type !== 'voucher' && type !== 'free_product') return null;
  return {
    id,
    storeId,
    buyerId: cleanString(record.buyerId),
    buyerEmail: normalizeEmail(cleanString(record.buyerEmail)),
    title,
    description: cleanString(record.description),
    type,
    value: cleanNumber(record.value),
    productName: cleanString(record.productName),
    code: cleanString(record.code),
    startsAt: cleanString(record.startsAt),
    endsAt: cleanString(record.endsAt),
    active: record.active !== false,
    createdAt: cleanString(record.createdAt),
    updatedAt: cleanString(record.updatedAt),
  };
};

export const isPersonalizedBenefitAvailable = (
  benefit: PersonalizedBenefit,
  at = new Date()
): boolean => {
  if (!benefit.active) return false;
  const time = at.getTime();
  const start = benefit.startsAt ? new Date(`${benefit.startsAt}T00:00:00`).getTime() : 0;
  const end = benefit.endsAt ? new Date(`${benefit.endsAt}T23:59:59.999`).getTime() : 0;
  if (start && Number.isFinite(start) && time < start) return false;
  if (end && Number.isFinite(end) && time > end) return false;
  return true;
};

export const benefitMatchesBuyer = (
  benefit: PersonalizedBenefit,
  buyerId: string,
  buyerEmail = ''
): boolean => {
  const id = buyerId.trim();
  const email = normalizeEmail(buyerEmail);
  return (!!id && benefit.buyerId === id) || (!!email && benefit.buyerEmail === email);
};

export const subscribeToPersonalizedBenefits = (
  storeId: string,
  onBenefits: (benefits: PersonalizedBenefit[]) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const normalized = storeId.trim();
  if (!normalized) {
    onBenefits([]);
    return () => undefined;
  }
  return onSnapshot(
    collection(db, getPersonalizedBenefitsCollectionPath(normalized)),
    snapshot => {
      const benefits = snapshot.docs
        .flatMap(item => {
          const parsed = parseBenefit(item.data());
          return parsed ? [parsed] : [];
        })
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      onBenefits(benefits);
    },
    error => {
      onBenefits([]);
      onError?.(error);
    }
  );
};

export const savePersonalizedBenefit = async (
  user: Pick<User, 'uid'>,
  draft: PersonalizedBenefitDraft
): Promise<string> => {
  const storeId = user.uid.trim();
  if (!storeId) throw new Error('Loja não identificada.');
  if (!draft.title.trim()) throw new Error('Informe o nome do benefício.');
  const buyerId = draft.buyerId.trim();
  const buyerEmail = normalizeEmail(draft.buyerEmail);
  if (!buyerId && !buyerEmail) throw new Error('Cliente não identificado.');
  if (draft.startsAt && draft.endsAt && draft.endsAt < draft.startsAt) {
    throw new Error('O fim do benefício não pode ser anterior ao início.');
  }

  const reference = doc(collection(db, getPersonalizedBenefitsCollectionPath(storeId)));
  const now = new Date().toISOString();
  await setDoc(reference, {
    id: reference.id,
    storeId,
    buyerId,
    buyerEmail,
    title: draft.title.trim(),
    description: draft.description.trim(),
    type: draft.type,
    value: Math.max(0, Number(draft.value) || 0),
    productName: draft.productName.trim(),
    code: draft.code.trim().toLocaleUpperCase('pt-BR'),
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    active: draft.active,
    createdAt: now,
    updatedAt: now,
    recordedAt: serverTimestamp(),
    schemaVersion: 1,
  });
  return reference.id;
};
