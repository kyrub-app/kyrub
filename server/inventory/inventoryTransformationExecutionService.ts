import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import {
  normalizeKyrubInventoryTransformationName,
  normalizeKyrubInventoryTransformationProposal,
  type KyrubInventoryTransformationInput,
  type KyrubInventoryTransformationOutput,
  type KyrubInventoryTransformationProposal,
  type KyrubInventoryTransformationUnit,
} from '../../shared/kyrubInventoryTransformation.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';

class InventoryTransformationExecutionError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'InventoryTransformationExecutionError';
  }
}

type InventoryItem = {
  id: string;
  name: string;
  unit: KyrubInventoryTransformationUnit;
  currentQuantity: number;
  minimumQuantity: number;
  purchaseCost: number;
  supplier: string;
  updatedAt: string;
};

const clean = (value: unknown, maximum = 180): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const isUnit = (value: unknown): value is KyrubInventoryTransformationUnit =>
  value === 'un' || value === 'kg' || value === 'g' || value === 'l' || value === 'ml';

const normalizeInventoryItem = (value: unknown): InventoryItem | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const id = clean(candidate.id);
  const name = clean(candidate.name);
  const unit = candidate.unit;
  const currentQuantity = typeof candidate.currentQuantity === 'number' && Number.isFinite(candidate.currentQuantity)
    ? Math.max(0, candidate.currentQuantity)
    : null;
  if (!id || !name || !isUnit(unit) || currentQuantity === null) return null;
  return {
    id,
    name,
    unit,
    currentQuantity,
    minimumQuantity: typeof candidate.minimumQuantity === 'number' && Number.isFinite(candidate.minimumQuantity)
      ? Math.max(0, candidate.minimumQuantity)
      : 0,
    purchaseCost: typeof candidate.purchaseCost === 'number' && Number.isFinite(candidate.purchaseCost)
      ? Math.max(0, candidate.purchaseCost)
      : 0,
    supplier: clean(candidate.supplier, 160),
    updatedAt: clean(candidate.updatedAt, 80),
  };
};

const itemKey = (name: string, unit: KyrubInventoryTransformationUnit): string =>
  `${normalizeKyrubInventoryTransformationName(name)}::${unit}`;

const deterministicItemId = (
  uid: string,
  name: string,
  unit: KyrubInventoryTransformationUnit
): string =>
  `inv-${createHash('sha256')
    .update(`${uid}:${normalizeKyrubInventoryTransformationName(name)}:${unit}`)
    .digest('hex')
    .slice(0, 24)}`;

const receiptIdFor = (uid: string, proposalId: string): string =>
  `inventory-transform-${createHash('sha256')
    .update(`${uid}:${proposalId}`)
    .digest('hex')
    .slice(0, 40)}`;

const transformationIdFor = (uid: string, proposalId: string): string =>
  `transform-${createHash('sha256')
    .update(`${uid}:${proposalId}`)
    .digest('hex')
    .slice(0, 40)}`;

const inputQuantityByKey = (
  inputs: KyrubInventoryTransformationInput[]
): Map<string, number> => {
  const totals = new Map<string, number>();
  for (const input of inputs) {
    const key = itemKey(input.name, input.unit);
    totals.set(key, (totals.get(key) ?? 0) + input.quantity);
  }
  return totals;
};

const outputQuantityByKey = (
  outputs: KyrubInventoryTransformationOutput[]
): Map<string, { quantity: number; output: KyrubInventoryTransformationOutput }> => {
  const totals = new Map<string, { quantity: number; output: KyrubInventoryTransformationOutput }>();
  for (const output of outputs) {
    const key = itemKey(output.name, output.unit);
    const previous = totals.get(key);
    totals.set(key, {
      quantity: (previous?.quantity ?? 0) + output.quantity,
      output: previous?.output ?? output,
    });
  }
  return totals;
};

export const isInventoryTransformationExecutionRequest = (
  value: unknown
): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.confirmed === true &&
    Boolean(candidate.proposal) &&
    typeof candidate.proposal === 'object' &&
    !Array.isArray(candidate.proposal) &&
    (candidate.proposal as Record<string, unknown>).type === 'transform_inventory';
};

export const executeAuthorizedInventoryTransformation = async (
  authorization: string,
  rawRequest: unknown
) => {
  const token = bearerToken(authorization);
  if (!token) {
    throw new InventoryTransformationExecutionError(
      401,
      'AUTH_REQUIRED',
      'Faça login novamente antes de confirmar a transformação de estoque.'
    );
  }
  const actor = await verifyFirebaseIdToken(token);
  if (!rawRequest || typeof rawRequest !== 'object' || Array.isArray(rawRequest)) {
    throw new InventoryTransformationExecutionError(400, 'INVALID_REQUEST', 'Transformação inválida.');
  }
  const request = rawRequest as Record<string, unknown>;
  if (request.confirmed !== true) {
    throw new InventoryTransformationExecutionError(
      409,
      'CONFIRMATION_REQUIRED',
      'Revise e confirme a transformação antes de alterar o estoque.'
    );
  }
  const proposal = normalizeKyrubInventoryTransformationProposal(request.proposal);
  if (!proposal) {
    throw new InventoryTransformationExecutionError(
      400,
      'INVALID_TRANSFORMATION',
      'Revise insumos, produtos gerados, perdas e unidades antes de confirmar.'
    );
  }

  const inventoryRef = adminDb.doc(`users/${actor.uid}/private_store/inventory`);
  const receiptId = receiptIdFor(actor.uid, proposal.id);
  const receiptRef = adminDb.doc(`kyrub_action_receipts/${receiptId}`);
  const transformationId = transformationIdFor(actor.uid, proposal.id);
  const transformationRef = inventoryRef.collection('transformations').doc(transformationId);

  const status = await adminDb.runTransaction(async transaction => {
    const [inventorySnapshot, receiptSnapshot] = await Promise.all([
      transaction.get(inventoryRef),
      transaction.get(receiptRef),
    ]);
    if (receiptSnapshot.exists) return 'already_applied' as const;

    const current = inventorySnapshot.data() as Record<string, unknown> | undefined;
    const rawCatalog = Array.isArray(current?.inventoryCatalog)
      ? current?.inventoryCatalog
      : Array.isArray(current?.catalog)
        ? current?.catalog
        : [];
    const catalog = (rawCatalog as unknown[])
      .map(normalizeInventoryItem)
      .filter((item): item is InventoryItem => Boolean(item));
    const now = new Date().toISOString();
    const inputs = inputQuantityByKey(proposal.inputs);
    const outputs = outputQuantityByKey(proposal.outputs);
    const consumedLines: Array<Record<string, unknown>> = [];
    const producedLines: Array<Record<string, unknown>> = [];
    let totalConsumedCost = 0;

    for (const [key, requiredQuantity] of inputs) {
      const index = catalog.findIndex(item => itemKey(item.name, item.unit) === key);
      if (index < 0) {
        const input = proposal.inputs.find(candidate => itemKey(candidate.name, candidate.unit) === key);
        throw new InventoryTransformationExecutionError(
          409,
          'INVENTORY_INPUT_NOT_FOUND',
          `${input?.name ?? 'Um insumo'} não está cadastrado no estoque privado.`
        );
      }
      const existing = catalog[index];
      if (requiredQuantity > existing.currentQuantity) {
        throw new InventoryTransformationExecutionError(
          409,
          'INSUFFICIENT_INVENTORY',
          `Não há saldo suficiente de ${existing.name}. Estoque atual: ${existing.currentQuantity} ${existing.unit}.`
        );
      }
      const resultingQuantity = existing.currentQuantity - requiredQuantity;
      totalConsumedCost += requiredQuantity * existing.purchaseCost;
      catalog[index] = { ...existing, currentQuantity: resultingQuantity, updatedAt: now };
      consumedLines.push({
        itemId: existing.id,
        name: existing.name,
        unit: existing.unit,
        quantity: requiredQuantity,
        previousQuantity: existing.currentQuantity,
        resultingQuantity,
        unitCost: existing.purchaseCost,
      });
    }

    for (const [key, aggregated] of outputs) {
      const index = catalog.findIndex(item => itemKey(item.name, item.unit) === key);
      if (index < 0) {
        const itemId = deterministicItemId(actor.uid, aggregated.output.name, aggregated.output.unit);
        catalog.push({
          id: itemId,
          name: aggregated.output.name,
          unit: aggregated.output.unit,
          currentQuantity: aggregated.quantity,
          minimumQuantity: 0,
          purchaseCost: 0,
          supplier: '',
          updatedAt: now,
        });
        producedLines.push({
          itemId,
          name: aggregated.output.name,
          unit: aggregated.output.unit,
          quantity: aggregated.quantity,
          resultingQuantity: aggregated.quantity,
          kind: aggregated.output.kind,
        });
        continue;
      }
      const existing = catalog[index];
      const resultingQuantity = existing.currentQuantity + aggregated.quantity;
      catalog[index] = { ...existing, currentQuantity: resultingQuantity, updatedAt: now };
      producedLines.push({
        itemId: existing.id,
        name: existing.name,
        unit: existing.unit,
        quantity: aggregated.quantity,
        previousQuantity: existing.currentQuantity,
        resultingQuantity,
        kind: aggregated.output.kind,
      });
    }

    const summary = {
      id: transformationId,
      proposalId: proposal.id,
      sourceKind: proposal.source.kind,
      sourceLabel: proposal.source.label ?? '',
      inputCount: proposal.inputs.length,
      outputCount: proposal.outputs.length,
      lossCount: proposal.losses.length,
      totalConsumedCost,
      createdAt: now,
    };
    const recent = Array.isArray(current?.recentInventoryTransformations)
      ? current.recentInventoryTransformations.filter(item =>
          item && typeof item === 'object' && !Array.isArray(item) &&
          (item as Record<string, unknown>).id !== transformationId
        )
      : [];

    transaction.set(inventoryRef, {
      ownerId: actor.uid,
      inventoryCatalog: catalog,
      catalog,
      recentInventoryTransformations: [summary, ...recent].slice(0, 20),
      lastInventoryTransformation: {
        ...summary,
        confirmedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    transaction.set(transformationRef, {
      schemaVersion: 1,
      ownerId: actor.uid,
      proposalId: proposal.id,
      actionType: 'transform_inventory',
      source: proposal.source,
      inputs: consumedLines,
      outputs: producedLines,
      losses: proposal.losses,
      totalConsumedCost,
      createdAt: FieldValue.serverTimestamp(),
    });

    transaction.set(receiptRef, {
      schemaVersion: 1,
      executionId: receiptId,
      actionId: proposal.id,
      actionType: 'transform_inventory',
      actorUid: actor.uid,
      origin: proposal.origin ?? 'kyrubia',
      inputProvenance: proposal.inputProvenance ?? 'user_intent',
      targetType: 'inventory_transformation',
      targetId: actor.uid,
      transformationId,
      result: 'success',
      createdAt: FieldValue.serverTimestamp(),
    });

    return 'success' as const;
  });

  return {
    actionId: proposal.id,
    type: proposal.type,
    status,
    entityId: actor.uid,
    transformationId,
    idempotencyKey: `kyrubia:transform_inventory:${actor.uid}:${proposal.id}`,
  };
};

export const mapInventoryTransformationExecutionError = (
  error: unknown
): { status: number; body: { error: string; code: string } } => {
  if (error instanceof InventoryTransformationExecutionError) {
    return { status: error.status, body: { error: error.message, code: error.code } };
  }
  console.error('[InventoryTransformation] execution failed.', error);
  return {
    status: 503,
    body: {
      error: 'Não foi possível transformar o estoque agora.',
      code: 'INVENTORY_TRANSFORMATION_UNAVAILABLE',
    },
  };
};
