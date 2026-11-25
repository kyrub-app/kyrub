// Offline inventory classifier: never lists buckets, fetches URLs, or deletes.
// A candidate is only a review hint, not proof of safe deletion.
export type MediaObject = { bucket: string; name: string; generation: string; sizeBytes: number; createdAtMs: number };
export type MediaReference = { bucket: string; name: string };
export type InventoryEvidence = {
  bucket: string;
  observedAtMs: number;
  objectsComplete: boolean;
  referencesComplete: boolean;
  writersQuiesced: boolean;
  references: readonly MediaReference[];
  pending: readonly MediaReference[];
};
export type MediaInventoryStatus = 'referenced' | 'pending' | 'recent' | 'unknown' | 'review_candidate';
export type MediaInventoryResult = { object: MediaObject; status: MediaInventoryStatus };

const MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const objectName = /^community-post-media\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\/(?:image-[a-f0-9-]{36}\.(?:jpg|png|webp)|video-[a-f0-9-]{36}\.(?:mp4|webm))$/;
const key = (item: MediaReference) => JSON.stringify([item.bucket, item.name]);
const validReference = (item: unknown, bucket: string): item is MediaReference => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const ref = item as Partial<MediaReference>;
  return ref.bucket === bucket && typeof ref.name === 'string' && objectName.test(ref.name);
};

// Ignore query parameters (including rotating download tokens). Reject
// lookalike hosts, bucket mismatches, malformed paths and nested object names.
export function parseCommunityMediaReference(value: string, bucket: string): MediaReference | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.host !== 'firebasestorage.googleapis.com' ||
        url.username || url.password) return null;
    const match = /^\/v0\/b\/([^/]+)\/o\/([^/]+)$/.exec(url.pathname);
    if (!match || match[1] !== bucket) return null;
    const name = decodeURIComponent(match[2]);
    return objectName.test(name) ? { bucket, name } : null;
  } catch { return null; }
}

export function classifyCommunityMediaInventory(
  objects: readonly MediaObject[], evidence: InventoryEvidence,
): MediaInventoryResult[] {
  const references = Array.isArray(evidence.references) ? evidence.references : [];
  const pendingReferences = Array.isArray(evidence.pending) ? evidence.pending : [];
  const referenced = new Set(references.filter(item => validReference(item, evidence.bucket)).map(key));
  const pending = new Set(pendingReferences.filter(item => validReference(item, evidence.bucket)).map(key));
  // An invalid reference is not evidence of absence. Preserve known protections
  // but never label a remaining object as a candidate from inconsistent inputs.
  const complete = evidence.objectsComplete === true && evidence.referencesComplete === true &&
    evidence.writersQuiesced === true &&
    typeof evidence.bucket === 'string' && /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(evidence.bucket) &&
    Array.isArray(evidence.references) && Array.isArray(evidence.pending) &&
    references.every(item => validReference(item, evidence.bucket)) &&
    pendingReferences.every(item => validReference(item, evidence.bucket)) &&
    objects.every(item => validReference(item, evidence.bucket) &&
      typeof item.generation === 'string' && /^[1-9][0-9]{0,19}$/.test(item.generation) &&
      Number.isSafeInteger(item.createdAtMs) && item.createdAtMs > 0 &&
      Number.isSafeInteger(evidence.observedAtMs) && evidence.observedAtMs >= item.createdAtMs &&
      Number.isSafeInteger(item.sizeBytes) && item.sizeBytes >= 0);
  const counts = new Map<string, number>();
  for (const object of objects) counts.set(key(object), (counts.get(key(object)) ?? 0) + 1);
  const uniqueInventory = [...counts.values()].every(count => count === 1);
  return objects.map(object => {
    let status: MediaInventoryStatus = 'unknown';
    const id = key(object);
    if (object.bucket !== evidence.bucket || !objectName.test(object.name)) return { object, status };
    if (referenced.has(id)) status = 'referenced';
    else if (pending.has(id)) status = 'pending';
    else if (!Number.isSafeInteger(object.createdAtMs) || object.createdAtMs <= 0 ||
        !Number.isSafeInteger(evidence.observedAtMs) ||
        evidence.observedAtMs < object.createdAtMs ||
        !Number.isSafeInteger(object.sizeBytes) || object.sizeBytes < 0 ||
        (typeof object.generation !== 'string' || !/^[1-9][0-9]{0,19}$/.test(object.generation)) || counts.get(id) !== 1) status = 'unknown';
    else if (evidence.observedAtMs - object.createdAtMs < MIN_AGE_MS) status = 'recent';
    else if (complete && uniqueInventory) status = 'review_candidate';
    return { object, status };
  });
}

export function summarizeCommunityMediaInventory(results: readonly MediaInventoryResult[]) {
  const summary: Record<MediaInventoryStatus, { count: number; bytes: number | null }> = {
    referenced: {count: 0, bytes: 0}, pending: {count: 0, bytes: 0},
    recent: {count: 0, bytes: 0}, unknown: {count: 0, bytes: 0},
    review_candidate: {count: 0, bytes: 0},
  };
  for (const {object, status} of results) {
    summary[status].count++;
    const current = summary[status].bytes;
    if (current === null || !Number.isSafeInteger(object.sizeBytes) || object.sizeBytes < 0 ||
        !Number.isSafeInteger(current + object.sizeBytes)) {
      summary[status].bytes = null; // unknown or beyond exact integer precision
    } else {
      summary[status].bytes = current + object.sizeBytes;
    }
  }
  return summary;
}
