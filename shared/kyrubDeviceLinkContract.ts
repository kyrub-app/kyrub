/**
 * Kyrub Device Fabric v1: identity and authority do NOT belong to the radio.
 * NFC identifies nearby tags, BLE connects a supported accessory, and LoRa
 * carries short RF frames between compatible radios/bridges.
 *
 * This module is a protocol contract, NOT a transmitter or signature verifier.
 */
export const KYRUB_DEVICE_KINDS = ['nfc_tag', 'lora_link'] as const;
export type KyrubDeviceKind = (typeof KYRUB_DEVICE_KINDS)[number];
export type KyrubDeviceTransport = 'nfc' | 'bluetooth_le' | 'lora';

export const KYRUB_LORA_FRAME_MAX_BYTES = 192;
export const KYRUB_LORA_MAX_TTL_SECONDS = 3600;

export type KyrubRadioEventKind = 'heartbeat' | 'presence' | 'location_hint';

/**
 * Transport-neutral frame. Private identity, phone, CPF, access tokens,
 * payments and grants MUST NEVER be copied into the RF frame.
 * Cryptographic authenticity, clock skew, dedup and replay protection are
 * checked by a trusted bridge/server before interpreting any event.
 */
export interface KyrubRadioEnvelopeV1 {
  version: 1;
  eventId: string;
  originDeviceId: string;
  kind: KyrubRadioEventKind;
  emittedAt: string;
  ttlSeconds: number;
  sequence: number;
  payloadBase64url: string;
  signatureBase64url: string;
}

/** Strict shape/size check only. Never use this function as authorization. */
export function inspectRadioEnvelopeShape(input: unknown): KyrubRadioEnvelopeV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('RADIO_FRAME_INVALID');
  const frame = input as Record<string, unknown>;
  const fields = ['version', 'eventId', 'originDeviceId', 'kind', 'emittedAt',
    'ttlSeconds', 'sequence', 'payloadBase64url', 'signatureBase64url'];
  if (Object.keys(frame).some(key => !fields.includes(key)) || fields.some(key => !(key in frame)) ||
    frame.version !== 1 ||
    !['heartbeat', 'presence', 'location_hint'].includes(String(frame.kind)) ||
    typeof frame.eventId !== 'string' || !/^[A-Za-z0-9_-]{12,128}$/.test(frame.eventId) ||
    typeof frame.originDeviceId !== 'string' || !/^[A-Za-z0-9_-]{12,128}$/.test(frame.originDeviceId) ||
    typeof frame.emittedAt !== 'string' || !Number.isFinite(Date.parse(frame.emittedAt)) ||
    !Number.isSafeInteger(frame.ttlSeconds) || (frame.ttlSeconds as number) < 1 ||
    (frame.ttlSeconds as number) > KYRUB_LORA_MAX_TTL_SECONDS ||
    !Number.isSafeInteger(frame.sequence) || (frame.sequence as number) < 0 ||
    typeof frame.payloadBase64url !== 'string' || !/^[A-Za-z0-9_-]*$/.test(frame.payloadBase64url) ||
    typeof frame.signatureBase64url !== 'string' || !/^[A-Za-z0-9_-]{43,256}$/.test(frame.signatureBase64url)) {
    throw Error('RADIO_FRAME_INVALID');
  }
  // base64url has 4/3 character expansion; enforce an upper bound before
  // allocating anything and never embed user data into this frame.
  const payloadLength = (frame.payloadBase64url as string).length;
  if (payloadLength > Math.ceil(KYRUB_LORA_FRAME_MAX_BYTES * 4 / 3) ||
    payloadLength % 4 === 1) throw Error('RADIO_FRAME_TOO_LARGE');
  return frame as unknown as KyrubRadioEnvelopeV1;
}
