import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export interface EncryptedSecretEnvelope {
  version: 1;
  algorithm: 'aes-256-gcm';
  iv: string;
  tag: string;
  ciphertext: string;
}

const decodeMasterKey = (serialized: string): Buffer => {
  const trimmed = serialized.trim();
  const key = /^[a-fA-F0-9]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');

  if (key.length !== 32) {
    throw new Error(
      'INTEGRATION_MASTER_KEY must be 32 bytes encoded as base64 or 64 hexadecimal characters.'
    );
  }

  return key;
};

export const getIntegrationMasterKey = (): Buffer => {
  const serialized = process.env.INTEGRATION_MASTER_KEY;
  if (!serialized) {
    throw new Error('INTEGRATION_MASTER_KEY is not configured on the server.');
  }
  return decodeMasterKey(serialized);
};

export const encryptIntegrationSecret = (
  value: unknown,
  key: Buffer,
  associatedData: string
): EncryptedSecretEnvelope => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);

  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
};

export const decryptIntegrationSecret = <T>(
  envelope: EncryptedSecretEnvelope,
  key: Buffer,
  associatedData: string
): T => {
  if (
    envelope.version !== 1 ||
    envelope.algorithm !== 'aes-256-gcm'
  ) {
    throw new Error('Unsupported integration secret envelope.');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(envelope.iv, 'base64')
  );
  decipher.setAAD(Buffer.from(associatedData, 'utf8'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');

  return JSON.parse(plaintext) as T;
};

export const createOpenDeliverySignature = (
  rawBody: Buffer,
  clientSecret: string
): string => createHmac('sha256', clientSecret).update(rawBody).digest('hex');

export const verifyOpenDeliverySignature = (
  rawBody: Buffer,
  clientSecret: string,
  receivedSignature: string
): boolean => {
  const expected = Buffer.from(
    createOpenDeliverySignature(rawBody, clientSecret),
    'utf8'
  );
  const received = Buffer.from(receivedSignature.trim().toLowerCase(), 'utf8');
  return expected.length === received.length && timingSafeEqual(expected, received);
};

export const integrationLookupId = (
  provider: string,
  externalStoreId: string
): string => {
  const digest = createHash('sha256')
    .update(`${provider}:${externalStoreId.trim()}`)
    .digest('hex');
  return `${provider}-${digest}`;
};
