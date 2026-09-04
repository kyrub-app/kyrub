import { inspectMercadoLivreOutboundRequirements } from '../integrations/mercadoLivreOutboundRequirementsService.js';
import { proposeMercadoLivreExternalPublication } from '../integrations/mercadoLivreOutboundPublicationService.js';
import { listPublicStoreConnectionRegistry } from '../integrations/storeConnectionRegistry.js';

const clean = (value: unknown, maximum = 240): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

export type KyrubiaMercadoLivreRequirementInspection =
  | {
      status: 'available';
      siteId: string;
      categorySuggestions: Array<{
        domainId: string;
        domainName: string;
        categoryId: string;
        categoryName: string;
      }>;
      authority: 'provider_api_refetch';
    }
  | {
      status: 'unavailable';
      message: string;
    };

export type KyrubiaMercadoLivrePrepareResult =
  | {
      prepared: true;
      proposalId: string;
      canonicalProductId: string;
      connectionId: string;
      providerPublicationModel: 'legacy_items' | 'user_products';
      providerStockAuthority: 'item_available_quantity' | 'stock_locations';
      missingRequirements: string[];
      requirementInspection: KyrubiaMercadoLivreRequirementInspection;
      externalWritePerformed: false;
      authorizationCreated: false;
    }
  | {
      prepared: false;
      reason:
        | 'mercado_livre_connection_required'
        | 'mercado_livre_connection_ambiguous'
        | 'product_not_found'
        | 'adapter_migration_required'
        | 'preparation_failed';
      message: string;
      externalWritePerformed: false;
      authorizationCreated: false;
    };

const preparationFailure = (
  reason: Exclude<KyrubiaMercadoLivrePrepareResult, { prepared: true }>['reason'],
  message: string
): KyrubiaMercadoLivrePrepareResult => ({
  prepared: false,
  reason,
  message,
  externalWritePerformed: false,
  authorizationCreated: false,
});

const inspectPreparedRequirements = async (input: {
  uid: string;
  proposalId: string;
}): Promise<KyrubiaMercadoLivreRequirementInspection> => {
  try {
    const inspection = await inspectMercadoLivreOutboundRequirements({
      storeId: input.uid,
      proposalId: input.proposalId,
      inspectedByUserId: input.uid,
    });
    return {
      status: 'available',
      siteId: inspection.siteId,
      categorySuggestions: inspection.categorySuggestions.map(suggestion => ({
        domainId: suggestion.domainId,
        domainName: suggestion.domainName,
        categoryId: suggestion.categoryId,
        categoryName: suggestion.categoryName,
      })),
      authority: inspection.authority,
    };
  } catch {
    return {
      status: 'unavailable',
      message:
        'O rascunho foi preparado, mas o Kyrub não conseguiu consultar as categorias oficiais do Mercado Livre agora. Nenhuma publicação externa foi executada.',
    };
  }
};

export const prepareKyrubiaMercadoLivrePublication = async (input: {
  uid: string;
  productId: string;
}): Promise<KyrubiaMercadoLivrePrepareResult> => {
  const uid = clean(input.uid, 160);
  const productId = clean(input.productId, 160);
  if (!uid || !productId || productId.includes('/')) {
    return preparationFailure(
      'product_not_found',
      'O Kyrub não recebeu um produto canônico válido para preparar a publicação.'
    );
  }

  const connections = (await listPublicStoreConnectionRegistry(uid)).filter(connection =>
    connection.provider === 'mercado_livre' &&
    connection.status === 'connected' &&
    connection.syncAuthority === 'manual_review'
  );
  if (connections.length === 0) {
    return preparationFailure(
      'mercado_livre_connection_required',
      'Conecte sua conta do Mercado Livre à Loja Kyrub antes de preparar uma publicação.'
    );
  }
  if (connections.length !== 1) {
    return preparationFailure(
      'mercado_livre_connection_ambiguous',
      'Há mais de uma conexão Mercado Livre elegível. Revise as conexões da loja antes de continuar.'
    );
  }

  try {
    const proposal = await proposeMercadoLivreExternalPublication({
      storeId: uid,
      connectionId: connections[0].id,
      canonicalProductId: productId,
      proposedByUserId: uid,
    });
    const requirementInspection = await inspectPreparedRequirements({
      uid,
      proposalId: proposal.id,
    });
    return {
      prepared: true,
      proposalId: proposal.id,
      canonicalProductId: proposal.canonicalProductId,
      connectionId: proposal.connectionId,
      providerPublicationModel: proposal.providerPublicationModel,
      providerStockAuthority: proposal.providerStockAuthority,
      missingRequirements: [...proposal.requirements.missing],
      requirementInspection,
      externalWritePerformed: false,
      authorizationCreated: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('MERCADO_LIVRE_OUTBOUND_PRODUCT_NOT_FOUND') ||
      message.includes('MERCADO_LIVRE_OUTBOUND_PRODUCT_INVALID')
    ) {
      return preparationFailure(
        'product_not_found',
        'O produto selecionado não está disponível como produto canônico da sua Loja Kyrub.'
      );
    }
    if (
      message.includes('ADAPTER_MIGRATION_REQUIRED') ||
      message.includes('STOCK_LOCATION_PUBLICATION_ADAPTER_REQUIRED')
    ) {
      return preparationFailure(
        'adapter_migration_required',
        'A conta conectada exige um modo de publicação ou estoque que o Kyrub ainda não pode preparar com segurança.'
      );
    }
    return preparationFailure(
      'preparation_failed',
      'O Kyrub não conseguiu preparar o rascunho do Mercado Livre agora. Nenhuma publicação externa foi executada.'
    );
  }
};
