export interface FreelanceOfferInput {
  title: string;
  description: string;
  requirements: string;
  paymentMinor: number;
}
export interface FreelanceOffer extends FreelanceOfferInput {
  id: string;
  ownerUid: string;
  status: 'open' | 'selected' | 'contracted' | 'in_progress' | 'completion_requested' | 'completed' | 'cancelled';
  startedAt?: string;
  completionRequestedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  selectedApplicantUid?: string;
  selectedAt?: string;
  contractedAt?: string;
  createdAt: string;
}
export interface FreelanceApplication {
  offerId: string;
  applicantUid: string;
  ownerUid: string;
  status: 'pending' | 'selected' | 'contracted' | 'withdrawn' | 'released' | 'in_progress' | 'completion_requested' | 'completed';
  startedAt?: string;
  completionRequestedAt?: string;
  completedAt?: string;
  withdrawnAt?: string;
  releasedAt?: string;
  releasedBy?: string;
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

export type FreelanceExecutionAction = 'start' | 'request_completion' | 'confirm_completion';
const transition = {
  start: { from:'contracted', to:'in_progress', at:'startedAt', actor:'worker' },
  request_completion: { from:'in_progress', to:'completion_requested', at:'completionRequestedAt', actor:'worker' },
  confirm_completion: { from:'completion_requested', to:'completed', at:'completedAt', actor:'owner' },
} as const;

/** Unselected or released applicants do not become contracted. A released application stays historical. */
export function releaseFreelanceSelection(offer: FreelanceOffer, application: FreelanceApplication, actorUid: string, confirmed: unknown, now: string): FreelanceSelectionResult {
  validatePair(offer,application,now);
  if (confirmed !== true || (actorUid !== offer.ownerUid && actorUid !== application.applicantUid)) throw new Error('FREELANCE_FORBIDDEN');
  if (application.status === 'released' && application.releasedBy === actorUid && application.releasedAt &&
      offer.selectedApplicantUid !== application.applicantUid) return {offer,application,changed:false};
  if (offer.status !== 'selected' || application.status !== 'selected' || !isSelectedPair(offer,application) ||
      offer.contractedAt || application.contractedAt || Date.parse(now) < Date.parse(offer.selectedAt!)) throw new Error('FREELANCE_CONFLICT');
  const {selectedApplicantUid: _uid, selectedAt: _at, ...remaining} = offer;
  return {offer:{...remaining,status:'open'}, application:{...application,status:'released',releasedAt:now,releasedBy:actorUid},changed:true};
}
export function withdrawFreelanceApplication(offer: FreelanceOffer, application: FreelanceApplication, actorUid: string, confirmed: unknown, now: string): FreelanceSelectionResult {
  validatePair(offer,application,now);
  if (confirmed !== true || actorUid !== application.applicantUid) throw new Error('FREELANCE_FORBIDDEN');
  if (application.status === 'withdrawn' && application.withdrawnAt) return {offer,application,changed:false};
  if (application.status !== 'pending' || offer.selectedApplicantUid === actorUid || Date.parse(now) < Date.parse(application.createdAt)) throw new Error('FREELANCE_CONFLICT');
  return {offer,application:{...application,status:'withdrawn',withdrawnAt:now},changed:true};
}
export function cancelOpenFreelanceOffer(offer: FreelanceOffer, actorUid: string, confirmed: unknown, now: string): FreelanceOffer {
  if (confirmed !== true || actorUid !== offer.ownerUid || !validFreelanceId(actorUid)) throw new Error('FREELANCE_FORBIDDEN');
  if (!validFreelanceId(offer.id) || !Number.isFinite(Date.parse(now)) || Date.parse(now) < Date.parse(offer.createdAt)) throw new Error('FREELANCE_INVALID');
  if (offer.status === 'cancelled' && offer.cancelledAt) return offer;
  if (offer.status !== 'open' || offer.selectedApplicantUid || offer.contractedAt) throw new Error('FREELANCE_CONFLICT');
  return {...offer,status:'cancelled',cancelledAt:now};
}
export function advanceFreelanceExecution(offer: FreelanceOffer, application: FreelanceApplication, actorUid: string, action: FreelanceExecutionAction, confirmed: unknown, now: string): FreelanceSelectionResult {
  validatePair(offer,application,now);
  if (!Object.prototype.hasOwnProperty.call(transition,action)) throw new Error('FREELANCE_INVALID');
  const rule = transition[action];
  if (confirmed !== true || !isSelectedPair(offer,application) ||
      actorUid !== (rule.actor === 'owner' ? offer.ownerUid : application.applicantUid)) throw new Error('FREELANCE_FORBIDDEN');
  const fields = ['contractedAt','startedAt','completionRequestedAt','completedAt'] as const;
  const step = fields.indexOf(rule.at);
  for(let i=0;i<step;i++){
    const field=fields[i]; const at=offer[field];
    if (!at || !Number.isFinite(Date.parse(at)) || application[field] !== at ||
        Date.parse(at) < Date.parse(i===0 ? offer.selectedAt! : offer[fields[i-1]]!)) throw new Error('FREELANCE_CONFLICT');
  }
  const current=offer[rule.at];
  if (offer.status === rule.to && application.status === rule.to && current &&
      Number.isFinite(Date.parse(current)) && application[rule.at] === current &&
      Date.parse(current) >= Date.parse(offer[fields[step-1]]!)) return {offer,application,changed:false};
  if (offer.status !== rule.from || application.status !== rule.from ||
      fields.slice(step).some(field => offer[field] || application[field]) ||
      Date.parse(now) < Date.parse(offer[fields[step-1]]!)) throw new Error('FREELANCE_CONFLICT');
  return {offer:{...offer,status:rule.to,[rule.at]:now},application:{...application,status:rule.to,[rule.at]:now},changed:true};
}
