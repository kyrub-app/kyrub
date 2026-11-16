/**
 * Delivery classification for Kyrub's pilot. These limits are conservative
 * operational guardrails, not Brazilian legal limits or proof of licensing.
 * Real-world release requires a reviewed, versioned logistics policy.
 */
export type CourierVehicleType = 'bicycle' | 'motorcycle' | 'car';
export type CourierCargoKind = 'food' | 'parcel';
export interface DeliveryCargo {
  kind: CourierCargoKind;
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  requiresSpecialHandling: false;
}
export type DeliveryCargoAssessment = {
  ready: boolean;
  cargo: DeliveryCargo | null;
  allowedVehicles: CourierVehicleType[];
  reason: string;
};

// Internal pilot envelopes; dimensions are orientation-independent.
export const COURIER_PILOT_ENVELOPES: Record<CourierVehicleType, {
  maxWeightKg: number; maxDimensionsCm: readonly [number, number, number];
}> = {
  bicycle: { maxWeightKg: 8, maxDimensionsCm: [50, 40, 35] },
  motorcycle: { maxWeightKg: 15, maxDimensionsCm: [65, 50, 45] },
  car: { maxWeightKg: 100, maxDimensionsCm: [140, 100, 90] },
};

export const isCourierVehicleType = (value: unknown): value is CourierVehicleType =>
  value === 'bicycle' || value === 'motorcycle' || value === 'car';

const isPositiveNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

export const assessDeliveryCargo = (value: unknown): DeliveryCargoAssessment => {
  const blocked = (reason: string): DeliveryCargoAssessment => ({
    ready: false, cargo: null, allowedVehicles: [], reason,
  });
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return blocked('Classificação de carga não informada pela loja.');
  }
  const input = value as Record<string, unknown>;
  if (input.kind !== 'food' && input.kind !== 'parcel') {
    return blocked('Informe se a carga é alimento ou objeto.');
  }
  if (![input.weightKg, input.lengthCm, input.widthCm, input.heightCm].every(isPositiveNumber)) {
    return blocked('Peso e três dimensões da carga precisam ser informados.');
  }
  // Only explicitly non-special handling is supported in the pilot.
  if (input.requiresSpecialHandling !== false) {
    return blocked('Cargas que exigem cuidados especiais ainda não são atendidas.');
  }
  const cargo: DeliveryCargo = {
    kind: input.kind,
    weightKg: input.weightKg as number,
    lengthCm: input.lengthCm as number,
    widthCm: input.widthCm as number,
    heightCm: input.heightCm as number,
    requiresSpecialHandling: false,
  };
  const dimensions = [cargo.lengthCm, cargo.widthCm, cargo.heightCm].sort((a,b) => b-a);
  const allowedVehicles = (Object.keys(COURIER_PILOT_ENVELOPES) as CourierVehicleType[])
    .filter(vehicle => {
      const envelope = COURIER_PILOT_ENVELOPES[vehicle];
      return cargo.weightKg <= envelope.maxWeightKg
        && dimensions.every((dimension, i) => dimension <= envelope.maxDimensionsCm[i]);
    });
  return allowedVehicles.length
    ? { ready: true, cargo, allowedVehicles, reason: '' }
    : blocked('Carga fora das capacidades operacionais previstas para o piloto.');
};

export const courierVehicleDocumentEligibility = (
  verification: Record<string, unknown> | undefined,
  vehicle: CourierVehicleType
): { eligible: boolean; reason: string } => {
  if (!verification || verification.status !== 'approved') {
    return { eligible: false, reason: 'Identidade não aprovada.' };
  }
  const approved = Array.isArray(verification.approvedProfiles)
    ? verification.approvedProfiles : [];
  if (vehicle === 'bicycle') {
    return approved.includes('bicycle_courier')
      ? { eligible: true, reason: '' }
      : { eligible: false, reason: 'Habilitação de entregador de bicicleta não aprovada.' };
  }
  if (!approved.includes('motorized_courier')) {
    return { eligible: false, reason: 'Habilitação motorizada não aprovada.' };
  }
  const expansion = verification.profileExpansion && typeof verification.profileExpansion === 'object'
    ? verification.profileExpansion as Record<string, unknown> : null;
  const expansionApproved = expansion?.profile === 'motorized_courier' && expansion.status === 'approved';
  const category = expansionApproved ? expansion.cnhCategory : verification.cnhCategory;
  const ear = expansionApproved ? expansion.cnhHasEar : verification.cnhHasEar;
  const documents = expansionApproved ? expansion.documentPaths : verification.documentPaths;
  const documentExists = Array.isArray(documents) && documents.length > 0
    && (expansionApproved || verification.documentType === 'cnh');
  const validCategory = typeof category === 'string' && category.trim().toUpperCase();
  const categoryString = validCategory || '';
  const letter = vehicle === 'motorcycle' ? 'A' : 'B';
  if (!documentExists || ear !== true || !categoryString.includes(letter)) {
    return {
      eligible: false,
      reason: vehicle === 'motorcycle'
        ? 'Moto exige habilitação motorizada aprovada, CNH categoria A e EAR.'
        : 'Carro exige habilitação motorizada aprovada, CNH categoria B e EAR.',
    };
  }
  return { eligible: true, reason: '' };
};
