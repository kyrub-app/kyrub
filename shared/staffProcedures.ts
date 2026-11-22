import {
  STAFF_NOTICE_AUDIENCE_ROLES,
  type StaffNoticeAudienceRole,
} from './staffNotices';

export const STAFF_POP_MAX_TITLE = 120;
export const STAFF_POP_MAX_BODY = 8000;
export const STAFF_POP_MAX_ATTACHMENT_BYTES = 1280 * 1024;
export const STAFF_POP_MAX_RESULTS = 50;
export const STAFF_POP_MAX_VERSIONS = 100;
export const STAFF_POP_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';

export const safePopId = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{12,96}$/.test(v);
export const safePopVersion = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= STAFF_POP_MAX_VERSIONS;

export type StaffPopAttachment = {
  path: string;
  name: string;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';
  sizeBytes: number;
  sha256: string;
};
export type StaffProcedure = {
  id: string;
  legacyStoreId: string;
  canonicalStoreId: string;
  title: string;
  currentVersion: number;
  audienceRoles: StaffNoticeAudienceRole[];
  lastRequestId: string;
  lastPayloadHash: string;
  publishedBy: string;
  publishedAt: string;
  status: 'published';
};
export type StaffProcedureRevision = {
  id: string;
  version: number;
  requestId: string;
  title: string;
  body: string;
  audienceRoles: StaffNoticeAudienceRole[];
  attachment: StaffPopAttachment | null;
  publishedBy: string;
  publishedAt: string;
};
export type StaffProcedureView = StaffProcedure & {
  revision: StaffProcedureRevision;
  readAt: string;
};

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const allowedTypes = new Set(STAFF_POP_ACCEPT.split(','));

export const validateStaffPopAttachment = (
  input: unknown,
  canonicalStoreId: string,
  procedureId: string,
  requestId: string
): StaffPopAttachment | null => {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw Error('STAFF_POP_ATTACHMENT_INVALID');
  const a = input as Record<string, unknown>;
  const path = clean(a.path), name = clean(a.name), mimeType = clean(a.mimeType);
  const sizeBytes = a.sizeBytes, sha256 = clean(a.sha256);
  if (!name || name.length > 160 ||
      !allowedTypes.has(mimeType) ||
      typeof sizeBytes !== 'number' || sizeBytes <= 0 ||
      sizeBytes > STAFF_POP_MAX_ATTACHMENT_BYTES || !Number.isSafeInteger(sizeBytes) ||
      !/^[a-f0-9]{64}$/.test(sha256) ||
      path !== 'staff-pops/' + canonicalStoreId + '/' + procedureId + '/' + requestId + '/' + sha256) {
    throw Error('STAFF_POP_ATTACHMENT_INVALID');
  }
  return { path, name, mimeType: mimeType as StaffPopAttachment['mimeType'], sizeBytes, sha256 };
};

export const validateStaffPopPublication = (input: {
  procedureId: unknown; requestId: unknown; expectedVersion: unknown;
  title: unknown; body: unknown; audienceRoles: unknown;
}) => {
  const procedureId = clean(input.procedureId), requestId = clean(input.requestId);
  const title = clean(input.title), body = clean(input.body);
  if (!safePopId(procedureId) || !safePopId(requestId) ||
      !safePopVersion(input.expectedVersion) ||
      !title || title.length > STAFF_POP_MAX_TITLE || body.length > STAFF_POP_MAX_BODY) {
    throw Error('STAFF_POP_INVALID');
  }
  if (!Array.isArray(input.audienceRoles) ||
      input.audienceRoles.length > STAFF_NOTICE_AUDIENCE_ROLES.length ||
      new Set(input.audienceRoles).size !== input.audienceRoles.length ||
      input.audienceRoles.some(x => !STAFF_NOTICE_AUDIENCE_ROLES.includes(x))) {
    throw Error('STAFF_POP_AUDIENCE_INVALID');
  }
  return {
    procedureId, requestId, title, body, expectedVersion: input.expectedVersion as number,
    audienceRoles: input.audienceRoles as StaffNoticeAudienceRole[],
  };
};

export const canReadStaffPop = (
  role: string,
  resource: Pick<StaffProcedure, 'status' | 'audienceRoles'>
): boolean => resource.status === 'published' && (
  role === 'owner' || role === 'manager' ||
  resource.audienceRoles.length === 0 ||
  resource.audienceRoles.includes(role as StaffNoticeAudienceRole)
);
