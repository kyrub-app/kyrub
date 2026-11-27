export interface FreelanceOfferInput {
  title: string;
  description: string;
  requirements: string;
  paymentMinor: number;
}
export interface FreelanceOffer extends FreelanceOfferInput {
  id: string;
  ownerUid: string;
  status: 'open';
  createdAt: string;
}
export interface FreelanceApplication {
  offerId: string;
  applicantUid: string;
  ownerUid: string;
  status: 'pending';
  createdAt: string;
}
export const validFreelanceId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function normalizeFreelanceOffer(input: unknown): FreelanceOfferInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('FREELANCE_INVALID');
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some(key => !['title','description','requirements','paymentMinor'].includes(key))) throw new Error('FREELANCE_INVALID');
  const text = (value: unknown, max: number, required: boolean): string => {
    if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new Error('FREELANCE_INVALID');
    return value.trim();
  };
  const paymentMinor = data.paymentMinor;
  if (typeof paymentMinor !== 'number' || !Number.isSafeInteger(paymentMinor) || paymentMinor <= 0 || paymentMinor > 999999999) throw new Error('FREELANCE_INVALID');
  return {title:text(data.title,120,true),description:text(data.description,4000,true),requirements:text(data.requirements ?? '',1000,false),paymentMinor};
}
export function createFreelanceOffer(id: string, ownerUid: string, input: unknown, now: string): FreelanceOffer {
  if (!validFreelanceId(id) || !validFreelanceId(ownerUid) || !Number.isFinite(Date.parse(now))) throw new Error('FREELANCE_INVALID');
  return { ...normalizeFreelanceOffer(input), id, ownerUid, status:'open', createdAt:now };
}
export function createFreelanceApplication(offer: FreelanceOffer, applicantUid: string, now: string): FreelanceApplication {
  if (!validFreelanceId(offer.id) || !validFreelanceId(offer.ownerUid) || !validFreelanceId(applicantUid) || !Number.isFinite(Date.parse(now))) throw new Error('FREELANCE_INVALID');
  if (offer.ownerUid === applicantUid || offer.status !== 'open') throw new Error('FREELANCE_FORBIDDEN');
  return {offerId:offer.id,ownerUid:offer.ownerUid,applicantUid,status:'pending',createdAt:now};
}
