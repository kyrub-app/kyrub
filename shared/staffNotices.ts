import type { StoreRole } from '../src/utils/storeSecurity';

export const STAFF_NOTICE_MAX_TITLE = 120;
export const STAFF_NOTICE_MAX_BODY = 2500;
export const STAFF_NOTICE_MAX_AUDIENCE = 4;
export const STAFF_NOTICE_MAX_RESULTS = 80;
export const STAFF_NOTICE_MAX_MEMBERS = 120;

export type StaffNoticeAudienceRole = Exclude<StoreRole, 'owner'>;
export const STAFF_NOTICE_AUDIENCE_ROLES: readonly StaffNoticeAudienceRole[] =
  ['manager', 'cashier', 'seller', 'production'];

export type StaffNotice = {
  id: string;
  canonicalStoreId: string;
  legacyStoreId: string;
  title: string;
  body: string;
  audienceRoles: StaffNoticeAudienceRole[]; // [] = entire active team
  publishedBy: string;
  createdAt: string;
  status: 'published';
};

export type StaffNoticeForViewer = StaffNotice & { readAt: string };

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
export const isSafeStaffNoticeId = (value: string): boolean =>
  /^[a-zA-Z0-9_-]{10,96}$/.test(value);

export const validateStaffNoticeInput = (input: {
  requestId: unknown;
  title: unknown;
  body: unknown;
  audienceRoles: unknown;
}): Pick<StaffNotice, 'id' | 'title' | 'body' | 'audienceRoles'> => {
  const id = clean(input.requestId);
  const title = clean(input.title);
  const body = clean(input.body);
  if (!isSafeStaffNoticeId(id) || !title || title.length > STAFF_NOTICE_MAX_TITLE ||
      !body || body.length > STAFF_NOTICE_MAX_BODY) {
    throw new Error('STAFF_NOTICE_INVALID');
  }
  if (!Array.isArray(input.audienceRoles) ||
      input.audienceRoles.length > STAFF_NOTICE_MAX_AUDIENCE ||
      new Set(input.audienceRoles).size !== input.audienceRoles.length ||
      input.audienceRoles.some(role => !STAFF_NOTICE_AUDIENCE_ROLES.includes(role))) {
    throw new Error('STAFF_NOTICE_INVALID_AUDIENCE');
  }
  return { id, title, body, audienceRoles: input.audienceRoles as StaffNoticeAudienceRole[] };
};

export const canReadStaffNotice = (
  role: StoreRole,
  notice: Pick<StaffNotice, 'status' | 'audienceRoles'>
): boolean =>
  notice.status === 'published' &&
  (role === 'owner' || notice.audienceRoles.length === 0 ||
    notice.audienceRoles.includes(role as StaffNoticeAudienceRole));
