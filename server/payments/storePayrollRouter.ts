import { Router } from 'express';
import { adminDb } from '../firebaseAdmin.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadOwnerStoreInstitutionalRepresentation } from '../store/storeInstitutionalIdentityService.js';
import {
  buildPayrollStoreFinancePayable,
  buildPayrollStoreFinancePayableId,
  normalizeStoreFinancePayable,
  storeFinancePayablePath,
  type StoreFinancePayable,
} from '../../shared/storeFinancePayables.js';
import {
  buildStoreTeamCompensation,
  normalizeStoreTeamCompensation,
  storeTeamCompensationPath,
  type StoreTeamCompensation,
  type StoreTeamCompensationKind,
} from '../../shared/storeTeamCompensation.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const validPeriod = (value: string): boolean =>
  /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value);

const mapError = (error: unknown): { status: number; message: string; code: string } => {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'AUTH_REQUIRED') return { status: 401, message: 'Faça login novamente.', code };
  if (code === 'STORE_REPRESENTATION_FORBIDDEN') return { status: 403, message: 'Somente o proprietário pode administrar remuneração e folha.', code };
  if (code === 'STORE_PAYROLL_STORE_REQUIRED') return { status: 400, message: 'Loja financeira não identificada.', code };
  if (code === 'STORE_PAYROLL_TEAM_STORE_REQUIRED') return { status: 400, message: 'Loja da equipe não identificada.', code };
  if (code === 'STORE_PAYROLL_TEAM_STORE_FORBIDDEN') return { status: 403, message: 'Esta equipe ainda não está vinculada ao financeiro da loja atual.', code };
  if (code === 'STORE_PAYROLL_MEMBER_NOT_FOUND') return { status: 404, message: 'Colaborador não encontrado na equipe selecionada.', code };
  if (code === 'STORE_PAYROLL_MEMBER_INACTIVE') return { status: 409, message: 'A remuneração só pode ser vinculada a um colaborador ativo.', code };
  if (code === 'STORE_PAYROLL_COMPENSATION_NOT_FOUND') return { status: 404, message: 'Configure a remuneração deste colaborador antes de gerar a competência.', code };
  if (code === 'STORE_PAYROLL_COMPENSATION_INACTIVE') return { status: 409, message: 'A remuneração deste colaborador está inativa.', code };
  if (code === 'STORE_PAYROLL_PERIOD_INVALID') return { status: 400, message: 'Competência inválida.', code };
  if (code.startsWith('STORE_TEAM_COMPENSATION_') || code.startsWith('STORE_FINANCE_PAYABLE_')) {
    return { status: 400, message: 'Revise os dados de remuneração ou da folha.', code };
  }
  console.error('[Store payroll]', error);
  return { status: 503, message: 'Não foi possível administrar a folha agora.', code: 'STORE_PAYROLL_UNAVAILABLE' };
};

const requireOwner = async (authorization: string, financeStoreId: string): Promise<string> => {
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  await loadOwnerStoreInstitutionalRepresentation({
    storeId: financeStoreId,
    authenticatedUserId: identity.uid,
  });
  return identity.uid;
};

type TeamMemberSnapshot = {
  userId: string;
  displayName: string;
  email: string;
  role: string;
  status: string;
};

const requireLinkedTeamStore = async (input: {
  financeStoreId: string;
  teamStoreId: string;
  ownerId: string;
}): Promise<void> => {
  const snapshot = await adminDb.doc(`stores/${input.teamStoreId}`).get();
  if (!snapshot.exists) throw new Error('STORE_PAYROLL_TEAM_STORE_FORBIDDEN');
  const data = snapshot.data() as Record<string, unknown>;
  const ownerId = clean(data.ownerId);
  const legacyTenantId = clean(data.legacyTenantId);
  if (
    ownerId !== input.ownerId
    || (input.teamStoreId !== input.financeStoreId && legacyTenantId !== input.financeStoreId)
  ) {
    throw new Error('STORE_PAYROLL_TEAM_STORE_FORBIDDEN');
  }
};

const requireActiveMember = async (input: {
  teamStoreId: string;
  memberUserId: string;
}): Promise<TeamMemberSnapshot> => {
  const snapshot = await adminDb.doc(`stores/${input.teamStoreId}/members/${input.memberUserId}`).get();
  if (!snapshot.exists) throw new Error('STORE_PAYROLL_MEMBER_NOT_FOUND');
  const data = snapshot.data() as Record<string, unknown>;
  if (clean(data.userId) !== input.memberUserId) throw new Error('STORE_PAYROLL_MEMBER_NOT_FOUND');
  const status = clean(data.status);
  if (status !== 'active') throw new Error('STORE_PAYROLL_MEMBER_INACTIVE');
  const displayName = clean(data.displayName) || clean(data.email) || input.memberUserId;
  return {
    userId: input.memberUserId,
    displayName,
    email: clean(data.email),
    role: clean(data.role) || 'member',
    status,
  };
};

const compensationKind = (value: unknown): StoreTeamCompensationKind => {
  if (value === 'salary' || value === 'fixed_fee') return value;
  throw new Error('STORE_TEAM_COMPENSATION_KIND_INVALID');
};

const listCompensations = async (input: {
  financeStoreId: string;
  teamStoreId: string;
}): Promise<StoreTeamCompensation[]> => {
  const snapshot = await adminDb
    .collection(`stores/${input.financeStoreId}/teamCompensations`)
    .limit(100)
    .get();

  return snapshot.docs.flatMap(document => {
    try {
      const compensation = normalizeStoreTeamCompensation({
        ...(document.data() as StoreTeamCompensation),
        id: document.id,
        financeStoreId: input.financeStoreId,
      });
      return compensation.teamStoreId === input.teamStoreId ? [compensation] : [];
    } catch (error) {
      console.warn('[Store payroll] Invalid compensation skipped.', {
        financeStoreId: input.financeStoreId,
        compensationId: document.id,
        error: error instanceof Error ? error.message : 'unknown',
      });
      return [];
    }
  }).sort((left, right) => left.memberDisplayNameSnapshot.localeCompare(right.memberDisplayNameSnapshot, 'pt-BR'));
};

const payrollDueDate = (period: string, payDay: number): string => {
  if (!validPeriod(period)) throw new Error('STORE_PAYROLL_PERIOD_INVALID');
  return `${period}-${String(payDay).padStart(2, '0')}`;
};

export const createStorePayrollRouter = (): Router => {
  const router = Router();

  router.get('/', async (request, response) => {
    try {
      const financeStoreId = clean(request.query.storeId);
      const teamStoreId = clean(request.query.teamStoreId);
      if (!financeStoreId) throw new Error('STORE_PAYROLL_STORE_REQUIRED');
      if (!teamStoreId) throw new Error('STORE_PAYROLL_TEAM_STORE_REQUIRED');
      const ownerId = await requireOwner(request.get('authorization') ?? '', financeStoreId);
      await requireLinkedTeamStore({ financeStoreId, teamStoreId, ownerId });
      const compensations = await listCompensations({ financeStoreId, teamStoreId });
      response.status(200).json({ financeStoreId, teamStoreId, compensations });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.post('/', async (request, response) => {
    try {
      const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
        ? request.body as Record<string, unknown>
        : {};
      const financeStoreId = clean(body.storeId);
      const teamStoreId = clean(body.teamStoreId);
      if (!financeStoreId) throw new Error('STORE_PAYROLL_STORE_REQUIRED');
      if (!teamStoreId) throw new Error('STORE_PAYROLL_TEAM_STORE_REQUIRED');
      const ownerId = await requireOwner(request.get('authorization') ?? '', financeStoreId);
      await requireLinkedTeamStore({ financeStoreId, teamStoreId, ownerId });
      const action = clean(body.action);

      if (action === 'save_member_compensation') {
        const memberUserId = clean(body.memberUserId);
        const member = await requireActiveMember({ teamStoreId, memberUserId });
        const ref = adminDb.doc(storeTeamCompensationPath(financeStoreId, memberUserId));
        const existingSnapshot = await ref.get();
        let createdAt = '';
        if (existingSnapshot.exists) {
          try {
            createdAt = normalizeStoreTeamCompensation({
              ...(existingSnapshot.data() as StoreTeamCompensation),
              id: memberUserId,
              financeStoreId,
            }).createdAt;
          } catch {
            createdAt = '';
          }
        }
        const compensation = buildStoreTeamCompensation({
          financeStoreId,
          teamStoreId,
          memberUserId,
          memberDisplayNameSnapshot: member.displayName,
          memberRoleSnapshot: member.role,
          kind: compensationKind(body.kind),
          monthlyAmountMinor: Number(body.monthlyAmountMinor),
          payDay: Number(body.payDay),
          active: body.active !== false,
          createdByUserId: ownerId,
          createdAt,
        });
        await ref.set(compensation);
        response.status(200).json({ compensation });
        return;
      }

      if (action === 'generate_payroll_payable') {
        const memberUserId = clean(body.memberUserId);
        const period = clean(body.period);
        if (!validPeriod(period)) throw new Error('STORE_PAYROLL_PERIOD_INVALID');
        const member = await requireActiveMember({ teamStoreId, memberUserId });
        const compensationSnapshot = await adminDb
          .doc(storeTeamCompensationPath(financeStoreId, memberUserId))
          .get();
        if (!compensationSnapshot.exists) throw new Error('STORE_PAYROLL_COMPENSATION_NOT_FOUND');
        const compensation = normalizeStoreTeamCompensation({
          ...(compensationSnapshot.data() as StoreTeamCompensation),
          id: memberUserId,
          financeStoreId,
        });
        if (compensation.teamStoreId !== teamStoreId) {
          throw new Error('STORE_PAYROLL_TEAM_STORE_FORBIDDEN');
        }
        if (!compensation.active) throw new Error('STORE_PAYROLL_COMPENSATION_INACTIVE');

        const payableId = buildPayrollStoreFinancePayableId({
          payrollPeriod: period,
          teamMemberUserId: memberUserId,
        });
        const payableRef = adminDb.doc(storeFinancePayablePath(financeStoreId, payableId));
        const result = await adminDb.runTransaction(async transaction => {
          const existing = await transaction.get(payableRef);
          if (existing.exists) {
            const payable = normalizeStoreFinancePayable({
              ...(existing.data() as StoreFinancePayable),
              id: payableId,
              storeId: financeStoreId,
            });
            return { payable, created: false };
          }

          const payable = buildPayrollStoreFinancePayable({
            id: payableId,
            storeId: financeStoreId,
            teamStoreId,
            teamMemberUserId: memberUserId,
            payrollPeriod: period,
            amountMinor: compensation.monthlyAmountMinor,
            memberDisplayName: member.displayName,
            dueDate: payrollDueDate(period, compensation.payDay),
            createdByUserId: ownerId,
          });
          transaction.set(payableRef, payable);
          return { payable, created: true };
        });

        response.status(result.created ? 201 : 200).json(result);
        return;
      }

      throw new Error('STORE_TEAM_COMPENSATION_ACTION_INVALID');
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  return router;
};