import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { authorizeIntegrationReadiness } from './integrationReadinessService.js';
import {
  DELIVERY_CUSTOMER_ARRIVAL_POLICY_PATH,
  parseAuthoritativeDeliveryCustomerArrivalPolicy,
} from '../delivery/deliveryCustomerArrivalPolicyService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const positiveInteger = (value: unknown): number => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
};

export interface AdminCustomerArrivalPolicyView {
  configured: boolean;
  policyId: string;
  version: number;
  enabled: boolean;
  radiusMeters: number;
  updatedAt: string;
}

const iso = (value: unknown): string => {
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return '';
};

const publicView = (value: Record<string, unknown> | undefined): AdminCustomerArrivalPolicyView => ({
  configured: Boolean(value && clean(value.policyId) && positiveInteger(value.version) && positiveInteger(value.radiusMeters)),
  policyId: clean(value?.policyId),
  version: positiveInteger(value?.version),
  enabled: value?.enabled === true,
  radiusMeters: positiveInteger(value?.radiusMeters),
  updatedAt: iso(value?.updatedAt),
});

const audit = async (input: {
  actorId: string;
  action: string;
  result: string;
  policyId: string;
  version: number;
  radiusMeters: number;
  enabled: boolean;
}): Promise<void> => {
  const id = randomUUID().replaceAll('-', '_');
  await adminDb.doc(`kyrub_admin/control_plane/audit_logs/${id}`).set({
    id,
    action: input.action,
    actorId: input.actorId,
    actorRole: 'super_admin',
    targetType: 'platform_operational_policy',
    targetId: 'deliveryCustomerArrival',
    policyId: input.policyId,
    version: input.version,
    radiusMeters: input.radiusMeters,
    enabled: input.enabled,
    result: input.result,
    source: 'server',
    createdAt: FieldValue.serverTimestamp(),
  });
};

export const loadAuthorizedCustomerArrivalPolicy = async (
  authorization: string
): Promise<AdminCustomerArrivalPolicyView> => {
  await authorizeIntegrationReadiness(authorization);
  const snapshot = await adminDb.doc(DELIVERY_CUSTOMER_ARRIVAL_POLICY_PATH).get();
  return publicView(snapshot.data() as Record<string, unknown> | undefined);
};

export const saveAuthorizedCustomerArrivalPolicy = async (input: {
  authorization: string;
  policyId: unknown;
  version: unknown;
  radiusMeters: unknown;
  enabled: unknown;
}): Promise<AdminCustomerArrivalPolicyView> => {
  const admin = await authorizeIntegrationReadiness(input.authorization);
  const policyId = clean(input.policyId);
  const version = positiveInteger(input.version);
  const radiusMeters = positiveInteger(input.radiusMeters);
  const enabled = input.enabled === true;
  if (!policyId) throw new Error('CUSTOMER_ARRIVAL_POLICY_ID_REQUIRED');
  if (!version) throw new Error('CUSTOMER_ARRIVAL_POLICY_VERSION_INVALID');
  if (!radiusMeters) throw new Error('CUSTOMER_ARRIVAL_POLICY_RADIUS_INVALID');

  const reference = adminDb.doc(DELIVERY_CUSTOMER_ARRIVAL_POLICY_PATH);
  const existing = await reference.get();
  const existingData = existing.data() as Record<string, unknown> | undefined;
  const existingVersion = positiveInteger(existingData?.version);
  if (existing.exists && version <= existingVersion) {
    throw new Error('CUSTOMER_ARRIVAL_POLICY_VERSION_MUST_INCREASE');
  }

  const candidate = {
    policyId,
    version,
    enabled,
    radiusMeters,
  };
  if (enabled && !parseAuthoritativeDeliveryCustomerArrivalPolicy(candidate, new Date().toISOString())) {
    throw new Error('CUSTOMER_ARRIVAL_POLICY_INVALID');
  }

  await reference.set({
    ...candidate,
    authority: 'kyrub_platform',
    updatedBy: admin.uid,
    updatedAt: FieldValue.serverTimestamp(),
    ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
  }, { merge: true });

  await audit({
    actorId: admin.uid,
    action: 'admin.operational_policy.delivery_customer_arrival.saved',
    result: enabled ? 'enabled' : 'disabled',
    policyId,
    version,
    radiusMeters,
    enabled,
  });

  const saved = await reference.get();
  return publicView(saved.data() as Record<string, unknown> | undefined);
};

export const mapCustomerArrivalPolicyAdminError = (error: unknown): {
  status: number;
  body: { error: string; code: string };
} => {
  const message = error instanceof Error ? error.message : String(error);
  if (/AUTH_REQUIRED|id-token|expired|revoked/i.test(message)) {
    return { status: 401, body: { error: 'Faça login novamente.', code: 'AUTH_REQUIRED' } };
  }
  if (message === 'EMAIL_NOT_VERIFIED' || message === 'FORBIDDEN') {
    return { status: 403, body: { error: 'Somente Super Admin pode alterar esta política.', code: 'FORBIDDEN' } };
  }
  if (message === 'CUSTOMER_ARRIVAL_POLICY_ID_REQUIRED') {
    return { status: 400, body: { error: 'Informe um identificador para a política.', code: message } };
  }
  if (message === 'CUSTOMER_ARRIVAL_POLICY_VERSION_INVALID') {
    return { status: 400, body: { error: 'A versão deve ser um inteiro positivo.', code: message } };
  }
  if (message === 'CUSTOMER_ARRIVAL_POLICY_RADIUS_INVALID') {
    return { status: 400, body: { error: 'O raio deve ser informado em metros como inteiro positivo.', code: message } };
  }
  if (message === 'CUSTOMER_ARRIVAL_POLICY_VERSION_MUST_INCREASE') {
    return { status: 409, body: { error: 'A nova versão precisa ser maior que a versão atualmente salva.', code: message } };
  }
  console.error('[Admin Customer Arrival Policy]', error);
  return { status: 503, body: { error: 'Não foi possível salvar a política de chegada ao cliente.', code: 'CUSTOMER_ARRIVAL_POLICY_UNAVAILABLE' } };
};
