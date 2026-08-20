import type { StoreIntegrationId } from './storeOperationalSettings';
import { STORE_INTEGRATION_IDS } from './storeOperationalSettings';

export type ExternalIdentityEntityType = 'store' | 'product' | 'sku' | 'order';

export interface ExternalIdentityMapping {
  storeId: string;
  channelId: StoreIntegrationId;
  entityType: ExternalIdentityEntityType;
  canonicalId: string;
  externalId: string;
}

const normalizeRequiredId = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  if (normalized.length > 240) {
    throw new Error(`${label} is too long.`);
  }
  return normalized;
};

const isStoreIntegrationId = (value: string): value is StoreIntegrationId =>
  (STORE_INTEGRATION_IDS as readonly string[]).includes(value);

export const buildExternalIdentityMapping = (
  input: ExternalIdentityMapping
): ExternalIdentityMapping => {
  const storeId = normalizeRequiredId(input.storeId, 'Store id');
  const canonicalId = normalizeRequiredId(input.canonicalId, 'Canonical id');
  const externalId = normalizeRequiredId(input.externalId, 'External id');

  if (!isStoreIntegrationId(input.channelId)) {
    throw new Error('Unknown external channel.');
  }

  return {
    storeId,
    channelId: input.channelId,
    entityType: input.entityType,
    canonicalId,
    externalId,
  };
};

export const getExternalIdentityMappingKey = (
  mapping: ExternalIdentityMapping
): string => {
  const normalized = buildExternalIdentityMapping(mapping);
  return [
    normalized.storeId,
    normalized.channelId,
    normalized.entityType,
    normalized.canonicalId,
  ].map(part => encodeURIComponent(part)).join('::');
};

const sameScope = (
  left: ExternalIdentityMapping,
  right: ExternalIdentityMapping
): boolean =>
  left.storeId === right.storeId &&
  left.channelId === right.channelId &&
  left.entityType === right.entityType;

export const upsertExternalIdentityMapping = (
  mappings: ExternalIdentityMapping[],
  input: ExternalIdentityMapping
): ExternalIdentityMapping[] => {
  const next = buildExternalIdentityMapping(input);
  const normalizedMappings = mappings.map(buildExternalIdentityMapping);

  const collision = normalizedMappings.find(mapping =>
    sameScope(mapping, next) &&
    mapping.externalId === next.externalId &&
    mapping.canonicalId !== next.canonicalId
  );

  if (collision) {
    throw new Error(
      `External id collision for ${next.channelId}/${next.entityType}.`
    );
  }

  const withoutPreviousCanonicalMapping = normalizedMappings.filter(mapping =>
    !(
      sameScope(mapping, next) &&
      mapping.canonicalId === next.canonicalId
    )
  );

  return [...withoutPreviousCanonicalMapping, next];
};

export const resolveCanonicalIdByExternalId = (
  mappings: ExternalIdentityMapping[],
  input: {
    storeId: string;
    channelId: StoreIntegrationId;
    entityType: ExternalIdentityEntityType;
    externalId: string;
  }
): string | null => {
  const storeId = normalizeRequiredId(input.storeId, 'Store id');
  const externalId = normalizeRequiredId(input.externalId, 'External id');
  const matches = mappings
    .map(buildExternalIdentityMapping)
    .filter(mapping =>
      mapping.storeId === storeId &&
      mapping.channelId === input.channelId &&
      mapping.entityType === input.entityType &&
      mapping.externalId === externalId
    );

  if (matches.length > 1) {
    throw new Error('Ambiguous external identity mapping.');
  }

  return matches[0]?.canonicalId ?? null;
};

export const resolveExternalIdByCanonicalId = (
  mappings: ExternalIdentityMapping[],
  input: {
    storeId: string;
    channelId: StoreIntegrationId;
    entityType: ExternalIdentityEntityType;
    canonicalId: string;
  }
): string | null => {
  const storeId = normalizeRequiredId(input.storeId, 'Store id');
  const canonicalId = normalizeRequiredId(input.canonicalId, 'Canonical id');
  const match = mappings
    .map(buildExternalIdentityMapping)
    .find(mapping =>
      mapping.storeId === storeId &&
      mapping.channelId === input.channelId &&
      mapping.entityType === input.entityType &&
      mapping.canonicalId === canonicalId
    );

  return match?.externalId ?? null;
};
