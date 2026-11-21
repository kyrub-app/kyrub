import { KYRUB_DEVICE_KINDS, type KyrubDeviceKind } from '../../shared/kyrubDeviceLinkContract';

export interface LocalKyrubDeviceDraft {
  id: string;
  label: string;
  kind: KyrubDeviceKind;
  createdAt: string;
  lastNfcReadAt?: string;
}

export const KYRUB_LOCAL_DEVICE_LIMIT = 12;
const keyFor = (uid: string) => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw Error('DEVICE_USER_REQUIRED');
  return `kyrub_device_preparations_v1_${uid}`;
};

export const normalizeDeviceLabel = (input: string): string =>
  input.trim().replace(/\s+/g, ' ').slice(0, 48);

const isDraft = (value: unknown): value is LocalKyrubDeviceDraft => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const d = value as Record<string, unknown>;
  return typeof d.id === 'string' && /^[A-Za-z0-9_-]{12,128}$/.test(d.id) &&
    typeof d.label === 'string' && d.label.length > 0 && d.label.length <= 48 &&
    KYRUB_DEVICE_KINDS.includes(d.kind as KyrubDeviceKind) &&
    typeof d.createdAt === 'string' && Number.isFinite(Date.parse(d.createdAt)) &&
    (d.lastNfcReadAt === undefined ||
      (d.kind === 'nfc_tag' && typeof d.lastNfcReadAt === 'string' &&
        Number.isFinite(Date.parse(d.lastNfcReadAt))));
};

export function parseLocalDeviceDrafts(raw: string | null): LocalKyrubDeviceDraft[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const ids = new Set<string>();
    return data.filter((item): item is LocalKyrubDeviceDraft => {
      if (!isDraft(item) || ids.has(item.id)) return false;
      ids.add(item.id);
      return true;
    }).slice(0, KYRUB_LOCAL_DEVICE_LIMIT)
      .map(item => ({
        id: item.id, label: item.label, kind: item.kind, createdAt: item.createdAt,
        ...(item.lastNfcReadAt ? { lastNfcReadAt: item.lastNfcReadAt } : {}),
      }));
  } catch {
    return [];
  }
}

/**
 * Device drafts contain only user-written nickname, kind and NFC read time.
 * NO hardware serial, NDEF payload, opaque provisioning tokens, BLE key, GPS,
 * private identity or RF message is persisted.
 * These are NOT cloud claims or cryptographic pairings.
 */
export function loadLocalDeviceDrafts(storage: Pick<Storage, 'getItem'>, uid: string): LocalKyrubDeviceDraft[] {
  return parseLocalDeviceDrafts(storage.getItem(keyFor(uid)));
}

export function saveLocalDeviceDrafts(storage: Pick<Storage, 'setItem'>, uid: string, drafts: readonly LocalKyrubDeviceDraft[]) {
  if (drafts.length > KYRUB_LOCAL_DEVICE_LIMIT || drafts.some(d => !isDraft(d))) throw Error('DEVICE_DRAFT_INVALID');
  storage.setItem(keyFor(uid), JSON.stringify(drafts.map(d => ({
    id: d.id, label: d.label, kind: d.kind, createdAt: d.createdAt,
    ...(d.lastNfcReadAt ? { lastNfcReadAt: d.lastNfcReadAt } : {}),
  }))));
}
