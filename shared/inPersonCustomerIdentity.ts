export type InPersonCustomerLookupKind = 'name' | 'cpf' | 'phone';

export type InPersonCustomerIdentityStatus =
  | 'unverified_local'
  | 'verified_account';

export type InPersonCustomerPaymentState =
  | 'not_started'
  | 'pending'
  | 'partial'
  | 'paid'
  | 'paid_unattributed'
  | 'refunded'
  | 'attention'
  | 'reconciliation_required';

export interface InPersonCustomerLookupInput {
  storeId: string;
  orderId: string;
  kind: InPersonCustomerLookupKind;
  query: string;
}

export interface InPersonCustomerLinkInput {
  storeId: string;
  orderId: string;
  customerRef: string;
}

export interface InPersonCustomerCandidate {
  customerRef: string;
  displayName: string;
  maskedEmail: string;
  maskedPhone: string;
  matchKind: InPersonCustomerLookupKind;
  identityVerified: boolean;
  linkable: boolean;
  requiresCustomerConfirmation: boolean;
}

export interface InPersonCustomerPaymentSummary {
  state: InPersonCustomerPaymentState;
  orderPaymentStatus: 'unpaid' | 'partial' | 'paid';
  expectedAmount: number;
  authoritativelyPaidAmount: number;
  pendingPaymentCount: number;
  paymentCount: number;
  attributedToLinkedCustomer: boolean;
}

export interface InPersonCustomerContext {
  orderId: string;
  customerId: string;
  customerName: string;
  identityStatus: InPersonCustomerIdentityStatus;
  payment: InPersonCustomerPaymentSummary;
}

const clean = (value: unknown, max = 240): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, max)
    : '';

export const onlyDigits = (value: unknown): string =>
  clean(value).replace(/\D/g, '');

export const normalizeCustomerNameLookup = (value: unknown): string =>
  clean(value, 160);

export const normalizeCpfLookup = (value: unknown): string => {
  const digits = onlyDigits(value);
  if (digits.length !== 11) throw new Error('IN_PERSON_CUSTOMER_CPF_INVALID');
  return digits;
};

export const normalizePhoneLookup = (value: unknown): string => {
  const digits = onlyDigits(value);
  if (digits.length < 10 || digits.length > 13) {
    throw new Error('IN_PERSON_CUSTOMER_PHONE_INVALID');
  }
  return digits;
};

const appendBrazilianPhoneFormats = (
  variants: Set<string>,
  nationalDigits: string
): void => {
  if (nationalDigits.length !== 10 && nationalDigits.length !== 11) return;
  const area = nationalDigits.slice(0, 2);
  const subscriber = nationalDigits.slice(2);
  const split = subscriber.length === 9 ? 5 : 4;
  const first = subscriber.slice(0, split);
  const last = subscriber.slice(split);
  variants.add(nationalDigits);
  variants.add(`(${area}) ${first}-${last}`);
  variants.add(`${area} ${first}-${last}`);
  variants.add(`+55${nationalDigits}`);
  variants.add(`+55 (${area}) ${first}-${last}`);
};

export const phoneLookupVariants = (value: unknown): string[] => {
  const raw = clean(value, 40);
  const digits = normalizePhoneLookup(value);
  const nationalDigits =
    digits.length === 12 || digits.length === 13
      ? digits.startsWith('55') ? digits.slice(2) : digits
      : digits;
  const variants = new Set<string>([raw, digits]);
  appendBrazilianPhoneFormats(variants, nationalDigits);
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    variants.add(`+${digits}`);
  }
  return [...variants].filter(Boolean).slice(0, 10);
};

export const parseInPersonCustomerLookupInput = (
  value: unknown
): InPersonCustomerLookupInput => {
  const candidate = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const storeId = clean(candidate.storeId, 180);
  const orderId = clean(candidate.orderId, 220);
  const kind = candidate.kind;
  if (!storeId || !orderId) throw new Error('IN_PERSON_CUSTOMER_LOOKUP_SCOPE_REQUIRED');
  if (kind !== 'name' && kind !== 'cpf' && kind !== 'phone') {
    throw new Error('IN_PERSON_CUSTOMER_LOOKUP_KIND_INVALID');
  }
  const query = kind === 'cpf'
    ? normalizeCpfLookup(candidate.query)
    : kind === 'phone'
      ? normalizePhoneLookup(candidate.query)
      : normalizeCustomerNameLookup(candidate.query);
  if (kind === 'name' && query.length < 3) {
    throw new Error('IN_PERSON_CUSTOMER_NAME_TOO_SHORT');
  }
  return { storeId, orderId, kind, query };
};

export const parseInPersonCustomerLinkInput = (
  value: unknown
): InPersonCustomerLinkInput => {
  const candidate = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const storeId = clean(candidate.storeId, 180);
  const orderId = clean(candidate.orderId, 220);
  const customerRef = clean(candidate.customerRef, 220);
  if (!storeId || !orderId || !customerRef) {
    throw new Error('IN_PERSON_CUSTOMER_LINK_REQUIRED');
  }
  return { storeId, orderId, customerRef };
};

export const isDirectStaffLinkAllowed = (
  kind: InPersonCustomerLookupKind,
  identityVerified: boolean
): boolean => identityVerified && (kind === 'cpf' || kind === 'phone');

export const maskCustomerEmail = (value: unknown): string => {
  const email = clean(value, 254).toLocaleLowerCase('pt-BR');
  const [local, domain] = email.split('@');
  if (!local || !domain) return '';
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(1, Math.min(5, local.length - visible.length)))}@${domain}`;
};

export const maskCustomerPhone = (value: unknown): string => {
  const digits = onlyDigits(value);
  if (digits.length < 4) return '';
  return `••••••${digits.slice(-4)}`;
};
