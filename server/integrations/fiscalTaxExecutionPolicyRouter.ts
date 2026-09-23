import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import type { FiscalHomologationDocumentFamily } from '../../shared/fiscalHomologationPolicy.js';
import type {
  FiscalGoodsLineTaxRule,
  FiscalOperationExecutionPolicy,
  FiscalServiceLineTaxRule,
} from '../../shared/fiscalTaxExecutionPolicy.js';
import {
  loadFiscalTaxExecutionPolicy,
  saveFiscalTaxExecutionPolicy,
} from './fiscalTaxExecutionPolicyRegistry.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const familyFrom = (value: unknown): FiscalHomologationDocumentFamily => {
  if (value === 'nfe' || value === 'nfce' || value === 'nfse') return value;
  throw new Error('FISCAL_TAX_EXECUTION_FAMILY_INVALID');
};

const authenticatedOwner = async (authorization: string, storeId: string) => {
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  if (identity.uid !== storeId) throw new Error('STORE_CONNECTION_FORBIDDEN');
  return identity;
};

const asRecord = <T>(value: unknown): Record<string, T> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, T>
    : {};

const mapError = (error: unknown): { status: number; message: string } => {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'AUTH_REQUIRED') return { status: 401, message: 'Faça login novamente.' };
  if (
    code === 'STORE_CONNECTION_FORBIDDEN' ||
    code === 'FISCAL_HOMOLOGATION_OWNER_REQUIRED'
  ) {
    return { status: 403, message: 'Você não pode administrar a política tributária desta loja.' };
  }
  if (code === 'FISCAL_TAX_EXECUTION_FAMILY_INVALID') {
    return { status: 400, message: 'Selecione uma família fiscal válida.' };
  }
  if (
    code === 'FISCAL_TAX_EXECUTION_POLICY_INCOMPLETE' ||
    code === 'FISCAL_TAX_EXECUTION_OPERATION_INCOMPLETE' ||
    code === 'FISCAL_TAX_RULE_GOODS_INCOMPLETE' ||
    code === 'FISCAL_TAX_RULE_SERVICE_INCOMPLETE' ||
    code === 'FISCAL_TAX_RULE_PRODUCT_INVALID'
  ) {
    return {
      status: 400,
      message: 'Complete apenas os dados tributários explicitamente orientados pelo responsável fiscal antes de salvar ou aprovar.',
    };
  }
  if (code === 'FISCAL_TAX_EXECUTION_POLICY_STORED_RECORD_INVALID') {
    return {
      status: 409,
      message: 'A política tributária armazenada está inconsistente e precisa de revisão antes de continuar.',
    };
  }
  if (code === 'FISCAL_HOMOLOGATION_CANONICAL_STORE_REQUIRED') {
    return {
      status: 409,
      message: 'A loja canônica precisa estar resolvida antes de configurar a política tributária.',
    };
  }
  return { status: 503, message: 'Não foi possível atualizar a política tributária agora.' };
};

export const createFiscalTaxExecutionPolicyRouter = (): Router => {
  const router = Router();

  router.get('/:storeId/:family', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      const identity = await authenticatedOwner(request.get('authorization') ?? '', storeId);
      const documentFamily = familyFrom(request.params.family);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json({
        policy: await loadFiscalTaxExecutionPolicy({
          tenantId: identity.uid,
          requestedByUserId: identity.uid,
          documentFamily,
        }),
      });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.put('/:storeId/:family', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      const identity = await authenticatedOwner(request.get('authorization') ?? '', storeId);
      const documentFamily = familyFrom(request.params.family);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json({
        policy: await saveFiscalTaxExecutionPolicy({
          tenantId: identity.uid,
          requestedByUserId: identity.uid,
          documentFamily,
          approveForHomologation: request.body?.approveForHomologation === true,
          accountingReference: clean(request.body?.accountingReference),
          effectiveFrom: clean(request.body?.effectiveFrom),
          operation: request.body?.operation as FiscalOperationExecutionPolicy,
          goodsRules: asRecord<FiscalGoodsLineTaxRule>(request.body?.goodsRules),
          serviceRules: asRecord<FiscalServiceLineTaxRule>(request.body?.serviceRules),
        }),
      });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  return router;
};
