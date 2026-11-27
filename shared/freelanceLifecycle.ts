export interface FreelanceOfferInput {
  title: string;
  description: string;
  requirements: string;
  paymentMinor: number;
}
export interface FreelanceOffer extends FreelanceOfferInput {
  id: string;
  ownerUid: string;
  status: 'open' | 'selected' | 'contracted';
  selectedApplicantUid?: string;
  selectedAt?: string;
  contractedAt?: string;
  createdAt: string;
}
export interface FreelanceApplication {
  offerId: string;
  applicantUid: string;
  ownerUid: string;
  status: 'pending' | 'selected' | 'contracted';
  selectedAt?: string;
  contractedAt?: string;
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

export interface FreelanceSelectionResult {
  offer: FreelanceOffer;
  application: FreelanceApplication;
  changed: boolean;
}
function validatePair(offer: FreelanceOffer, application: FreelanceApplication, now: string): void {
  if (!validFreelanceId(offer.id) || !validFreelanceId(offer.ownerUid) ||
      !validFreelanceId(application.applicantUid) ||
      application.offerId !== offer.id || application.ownerUid !== offer.ownerUid ||
      application.applicantUid === offer.ownerUid || !Number.isFinite(Date.parse(now)) ||
      !Number.isSafeInteger(offer.paymentMinor) || offer.paymentMinor <= 0 || offer.paymentMinor > 999999999) {
    throw new Error('FREELANCE_CONFLICT');
  }
}
function isSelectedPair(offer: FreelanceOffer, application: FreelanceApplication): boolean {
  return offer.selectedApplicantUid === application.applicantUid &&
    typeof offer.selectedAt === 'string' && Number.isFinite(Date.parse(offer.selectedAt)) &&
    application.selectedAt === offer.selectedAt;
}
export function selectFreelanceApplicant(
  offer: FreelanceOffer, application: FreelanceApplication, actorUid: string, now: string,
): FreelanceSelectionResult {
  validatePair(offer, application, now);
  if (actorUid !== offer.ownerUid) throw new Error('FREELANCE_FORBIDDEN');
  if (offer.status === 'selected' && application.status === 'selected' &&
      isSelectedPair(offer, application) && !offer.contractedAt && !application.contractedAt) {
    return {offer,application,changed:false};
  }
  if (offer.status !== 'open' || application.status !== 'pending' || offer.selectedApplicantUid ||
      offer.selectedAt || offer.contractedAt || application.selectedAt || application.contractedAt) {
    throw new Error('FREELANCE_CONFLICT');
  }
  return {
    offer:{...offer,status:'selected',selectedApplicantUid:application.applicantUid,selectedAt:now},
    application:{...application,status:'selected',selectedAt:now},
    changed:true,
  };
}
export function confirmFreelanceSelection(
  offer: FreelanceOffer, application: FreelanceApplication, actorUid: string, confirmed: unknown, now: string,
): FreelanceSelectionResult {
  validatePair(offer,application,now);
  if (confirmed !== true || actorUid !== application.applicantUid || !isSelectedPair(offer,application)) {
    throw new Error('FREELANCE_FORBIDDEN');
  }
  if (offer.status === 'contracted' && application.status === 'contracted' &&
      typeof offer.contractedAt === 'string' && Number.isFinite(Date.parse(offer.contractedAt)) &&
      offer.contractedAt === application.contractedAt) return {offer,application,changed:false};
  if (offer.status !== 'selected' || application.status !== 'selected' || offer.contractedAt || application.contractedAt ||
      Date.parse(now) < Date.parse(offer.selectedAt!)) throw new Error('FREELANCE_CONFLICT');
  return {offer:{...offer,status:'contracted',contractedAt:now},application:{...application,status:'contracted',contractedAt:now},changed:true};
}
