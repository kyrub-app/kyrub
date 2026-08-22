import type { User } from 'firebase/auth';
import type { KyrubInventoryTransformationProposal } from '../../shared/kyrubInventoryTransformation';
import { invalidateKyrubErpContext } from './erpReadActionService';

const SAFE_ACTION_ENDPOINT = '/api/action-execute';

export type InventoryTransformationExecutionResult = {
  actionId: string;
  type: 'transform_inventory';
  status: 'success' | 'already_applied';
  entityId: string;
  transformationId: string;
  idempotencyKey: string;
};

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  const text = await response.text().catch(() => '');
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object'
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
};

export const executeInventoryTransformation = async (
  user: User,
  proposal: KyrubInventoryTransformationProposal,
  confirmed: boolean
): Promise<InventoryTransformationExecutionResult> => {
  if (!confirmed) {
    throw new Error('A transformação de estoque exige confirmação humana.');
  }

  let token = '';
  try {
    token = await user.getIdToken(true);
  } catch {
    throw new Error(
      'Não foi possível validar sua sessão. Entre novamente antes de transformar o estoque.'
    );
  }

  let response: Response;
  try {
    response = await fetch(SAFE_ACTION_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ confirmed: true, proposal }),
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch {
    throw new Error(
      'Não foi possível conectar ao executor seguro do Kyrub. Tente novamente.'
    );
  }

  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(
      typeof body.error === 'string' && body.error.trim()
        ? body.error.trim()
        : `Não foi possível transformar o estoque (HTTP ${response.status}).`
    );
  }

  if (
    body.actionId !== proposal.id ||
    body.type !== 'transform_inventory' ||
    (body.status !== 'success' && body.status !== 'already_applied') ||
    typeof body.entityId !== 'string' ||
    typeof body.transformationId !== 'string' ||
    typeof body.idempotencyKey !== 'string'
  ) {
    throw new Error('O executor respondeu sem um recibo válido da transformação.');
  }

  invalidateKyrubErpContext(user.uid);
  return body as unknown as InventoryTransformationExecutionResult;
};
