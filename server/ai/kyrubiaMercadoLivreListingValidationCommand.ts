import { randomUUID } from 'node:crypto';
import type { KyrubiaTurnContext } from '../../shared/kyrubiaContext.js';
import { configureMercadoLivreOutboundCommercialRequirements } from '../integrations/mercadoLivreOutboundCommercialConfigurationService.js';
import { inspectKyrubiaMercadoLivreCommercialReadiness } from '../integrations/mercadoLivreKyrubiaCommercialReadinessService.js';
import {
  resolveMercadoLivreKyrubiaGateProposal,
  type MercadoLivreKyrubiaGateKind,
  type MercadoLivreKyrubiaGateProposalCandidate,
} from '../integrations/mercadoLivreKyrubiaGateProposalResolver.js';
import { validateKyrubiaMercadoLivreDraftListing } from '../integrations/mercadoLivreKyrubiaListingValidationService.js';
import { authorizeKyrubiaMercadoLivrePublication } from '../integrations/mercadoLivreKyrubiaPublicationAuthorizationService.js';
import { handleKyrubiaMercadoLivrePublicationExecutionCommand } from './kyrubiaMercadoLivrePublicationExecutionCommand.js';

export type KyrubiaMercadoLivreListingValidationCommandResult =
  | { handled: false }
  | {
      handled: true;
      reply: string;
      turnContext: KyrubiaTurnContext;
    };

type ShippingCommand = {
  mode: string;
  freeShipping: boolean;
  localPickUp: boolean;
};

type ExplicitGateCommand = {
  gate: MercadoLivreKyrubiaGateKind;
  canonicalMessage: 'Validar draft' | 'Autorizar publicação' | 'Publicar agora';
  requestedProposalId?: string;
};

const normalizeExplicitCommand = (message: string): string =>
  message.trim().replace(/[.!?…]+$/u, '').trim();

const parseExplicitGateCommand = (message: string): ExplicitGateCommand | null => {
  const normalized = normalizeExplicitCommand(message);
  const validation = /^(?:validar|valide)(?:\s+o)?\s+(?:draft|rascunho)(?:\s+id\s+([a-zA-Z0-9_-]{1,180}))?$/i.exec(normalized);
  if (validation) {
    return {
      gate: 'validate',
      canonicalMessage: 'Validar draft',
      ...(validation[1] ? { requestedProposalId: validation[1] } : {}),
    };
  }
  const authorization = /^(?:autorizar|autorize)(?:\s+a)?\s+publica(?:ção|cao)(?:\s+id\s+([a-zA-Z0-9_-]{1,180}))?$/i.exec(normalized);
  if (authorization) {
    return {
      gate: 'authorize',
      canonicalMessage: 'Autorizar publicação',
      ...(authorization[1] ? { requestedProposalId: authorization[1] } : {}),
    };
  }
  const publication = /^(?:publicar|publique)\s+agora(?:\s+id\s+([a-zA-Z0-9_-]{1,180}))?$/i.exec(normalized);
  if (publication) {
    return {
      gate: 'publish',
      canonicalMessage: 'Publicar agora',
      ...(publication[1] ? { requestedProposalId: publication[1] } : {}),
    };
  }
  return null;
};

const isExplicitDraftValidationCommand = (message: string): boolean =>
  parseExplicitGateCommand(message)?.gate === 'validate';

const isExplicitPublicationAuthorizationCommand = (message: string): boolean =>
  parseExplicitGateCommand(message)?.gate === 'authorize';

const parseShippingCommand = (message: string): ShippingCommand | null => {
  const match = /^(?:configurar|configure)\s+(?:o\s+)?frete\s+([a-z0-9_-]{1,120})(.*)$/i.exec(normalizeExplicitCommand(message));
  if (!match?.[1]) return null;
  const qualifiers = (match[2] ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
  if (
    qualifiers &&
    !/^(?:com\s+frete\s+gratis|com\s+retirada\s+local|com\s+frete\s+gratis\s+e\s+retirada\s+local|com\s+retirada\s+local\s+e\s+frete\s+gratis)$/i.test(qualifiers)
  ) {
    return null;
  }
  return {
    mode: match[1],
    freeShipping: /frete\s+gratis/.test(qualifiers),
    localPickUp: /retirada\s+local/.test(qualifiers),
  };
};

const proposalIdFromPreparationContext = (
  context: KyrubiaTurnContext
): string => {
  if (
    context.sourceAction !== 'mercado_livre_publication_preparation' &&
    context.sourceAction !== 'mercado_livre_requirement_options'
  ) {
    return '';
  }

  const progressProposalId = context.mercadoLivreRequirementProgress?.proposalId.trim() ?? '';
  if (progressProposalId) return progressProposalId;

  const selectedIntent = context.selectedIntent;
  if (
    selectedIntent?.intent === 'mercado_livre.category_select' ||
    selectedIntent?.intent === 'mercado_livre.condition_select' ||
    selectedIntent?.intent === 'mercado_livre.listing_type_select' ||
    selectedIntent?.intent === 'mercado_livre.attribute_value_select'
  ) {
    return selectedIntent.payload.proposalId.trim();
  }

  return '';
};

const refreshedPreparationContext = (
  context: KyrubiaTurnContext
): KyrubiaTurnContext => ({
  ...context,
  id: randomUUID(),
  sourceAction: 'mercado_livre_publication_preparation',
  generatedAt: new Date().toISOString(),
  offeredIntents: undefined,
  mercadoLivreRequirementProgress: undefined,
});

const emptyRecoveryContext = (userId: string): KyrubiaTurnContext => ({
  version: 1,
  id: randomUUID(),
  source: 'kyrub_runtime',
  sourceAction: 'mercado_livre_publication_preparation',
  generatedAt: new Date().toISOString(),
  scope: { kind: 'own_store', storeId: userId },
  entities: [],
});

const recoveredPreparationContext = (
  userId: string,
  candidate: MercadoLivreKyrubiaGateProposalCandidate
): KyrubiaTurnContext => ({
  version: 1,
  id: randomUUID(),
  source: 'kyrub_runtime',
  sourceAction: 'mercado_livre_publication_preparation',
  generatedAt: new Date().toISOString(),
  scope: { kind: 'own_store', storeId: userId },
  entities: [{
    entityType: 'product',
    entityId: candidate.canonicalProductId,
    label: candidate.productName,
    position: 1,
  }],
  selectedIntent: {
    id: `ml-gate-${candidate.proposalId}`.slice(0, 160),
    intent: 'mercado_livre.listing_type_select',
    label: candidate.listingTypeName,
    payload: {
      proposalId: candidate.proposalId,
      categoryId: candidate.categoryId,
      categoryName: candidate.categoryName,
      condition: candidate.condition,
      listingTypeId: candidate.listingTypeId,
      listingTypeName: candidate.listingTypeName,
      providerAuthority: 'provider_api_requirement_options',
    },
    authorization: 'intent_only',
  },
});

const gateCommandExample = (
  gate: MercadoLivreKyrubiaGateKind,
  proposalId: string
): string => {
  if (gate === 'authorize') return `Autorizar publicação ID ${proposalId}`;
  if (gate === 'publish') return `Publicar agora ID ${proposalId}`;
  return `Validar draft ID ${proposalId}`;
};

const gateRecoveryReply = (input: {
  gate: MercadoLivreKyrubiaGateKind;
  status: 'ambiguous' | 'not_found';
  candidates: MercadoLivreKyrubiaGateProposalCandidate[];
  requestedProposalId?: string;
}): string => {
  if (input.status === 'ambiguous') {
    const candidates = input.candidates
      .map((candidate, index) => `${index + 1}) ${candidate.productName} · proposal ${candidate.proposalId} · produto ${candidate.canonicalProductId}`)
      .join('; ');
    return [
      'O comando do Mercado Livre foi reconhecido, mas existe mais de um draft persistido elegível para esse gate.',
      `Encontrei: ${candidates}.`,
      `Escolha explicitamente um proposal, por exemplo: “${gateCommandExample(input.gate, input.candidates[0].proposalId)}”.`,
      'O Kyrub não escolheu nenhum automaticamente, não recorreu à IA genérica e não publicou nada.',
    ].join(' ');
  }
  return [
    input.requestedProposalId
      ? `O comando foi reconhecido, mas o proposal ${input.requestedProposalId} não está elegível para esse gate no estado persistido atual.`
      : 'O comando foi reconhecido, mas não encontrei um draft persistido elegível para esse gate no estado atual.',
    'O Kyrub não usou texto da IA como prova de validação ou autorização e não publicou nada.',
  ].join(' ');
};

const compactCause = (
  cause: { code: string; message: string; reference: string }
): string => {
  const parts = [cause.code, cause.message, cause.reference].filter(Boolean);
  return parts.join(' — ');
};

const validationUnavailableReply = (error: unknown): string => {
  const code = error instanceof Error
    ? error.message.split(':')[0]
    : 'MERCADO_LIVRE_KYRUBIA_LISTING_VALIDATION_UNAVAILABLE';
  return [
    `O comando “Validar draft” foi reconhecido, mas o gate autoritativo bloqueou a validação (${code}).`,
    'O Kyrub não usou o turnContext como prova de configuração: o draft persistido, a evidência condicional, a capability e o produto canônico precisam continuar coerentes no servidor.',
    'Nenhuma autorização de publicação foi criada e nenhum anúncio foi criado ou alterado no Mercado Livre.',
  ].join(' ');
};

const shippingUnavailableReply = (error: unknown): string => {
  const code = error instanceof Error
    ? error.message.split(':')[0]
    : 'MERCADO_LIVRE_KYRUBIA_COMMERCIAL_READINESS_UNAVAILABLE';
  return [
    `Não consegui confirmar agora os modos de frete oficiais dessa conta e categoria (${code}).`,
    'O Kyrub não escolheu um modo por suposição e não chamou /items/validate.',
    'Nenhuma autorização de publicação foi criada e nenhum anúncio foi publicado.',
  ].join(' ');
};

const authorizationUnavailableReply = (error: unknown): string => {
  const code = error instanceof Error
    ? error.message.split(':')[0]
    : 'MERCADO_LIVRE_KYRUBIA_PUBLICATION_AUTHORIZATION_UNAVAILABLE';
  return [
    `O comando “Autorizar publicação” foi reconhecido, mas o gate autoritativo bloqueou a autorização (${code}).`,
    'A autorização só nasce se a validação 204 da Cairubia, o payload, a capability e o produto canônico ainda forem exatamente os mesmos no servidor.',
    'Nenhuma autorização utilizável foi criada para este comando e nenhum anúncio foi publicado ou alterado no Mercado Livre.',
  ].join(' ');
};

const shippingSelectionReply = (input: {
  allowedModes: string[];
  localPickUpAvailable: boolean;
}): string => {
  const modes = input.allowedModes.map(mode => `“${mode}”`).join(', ');
  const examples = input.allowedModes.slice(0, 3).map(mode => `“Configurar frete ${mode}”`).join(', ');
  return [
    'Antes de chamar /items/validate, falta definir o frete com base nas preferências atuais da sua própria conta do Mercado Livre.',
    `Modo(s) oficialmente compatível(is) com esta conta e categoria: ${modes}.`,
    input.localPickUpAvailable
      ? 'A conta também informa retirada local disponível.'
      : 'A conta não informa retirada local disponível para esta configuração.',
    `Escolha um dos modos dizendo exatamente ${examples}.`,
    'Sem complemento, o Kyrub configura frete grátis=false e retirada local=false. Se for realmente a sua escolha, você pode acrescentar “com frete grátis”, “com retirada local” ou ambos.',
    'Nenhuma escolha foi feita pelo Kyrub, /items/validate ainda não foi chamado e nada foi autorizado ou publicado.',
  ].join(' ');
};

export const handleKyrubiaMercadoLivreListingValidationCommand = async (input: {
  userId: string;
  message: string;
  context?: KyrubiaTurnContext;
}): Promise<KyrubiaMercadoLivreListingValidationCommandResult> => {
  const explicitGate = parseExplicitGateCommand(input.message);
  let context = input.context;
  let proposalId = context ? proposalIdFromPreparationContext(context) : '';
  let commandMessage = input.message;

  if (explicitGate && (explicitGate.requestedProposalId || !context || !proposalId)) {
    try {
      const resolution = await resolveMercadoLivreKyrubiaGateProposal({
        storeId: input.userId,
        gate: explicitGate.gate,
        ...(explicitGate.requestedProposalId
          ? { requestedProposalId: explicitGate.requestedProposalId }
          : {}),
      });
      if (resolution.status !== 'resolved') {
        return {
          handled: true,
          turnContext: context ?? emptyRecoveryContext(input.userId),
          reply: gateRecoveryReply({
            gate: explicitGate.gate,
            status: resolution.status,
            candidates: resolution.candidates,
            ...(explicitGate.requestedProposalId
              ? { requestedProposalId: explicitGate.requestedProposalId }
              : {}),
          }),
        };
      }
      context = recoveredPreparationContext(input.userId, resolution.candidate);
      proposalId = resolution.candidate.proposalId;
      commandMessage = explicitGate.canonicalMessage;
    } catch (error) {
      const code = error instanceof Error
        ? error.message.split(':')[0]
        : 'MERCADO_LIVRE_KYRUBIA_GATE_PROPOSAL_RECOVERY_FAILED';
      return {
        handled: true,
        turnContext: context ?? emptyRecoveryContext(input.userId),
        reply: `O comando do Mercado Livre foi reconhecido, mas não consegui recuperar com segurança o draft persistido (${code}). Não recorri à IA genérica e nada foi autorizado ou publicado.`,
      };
    }
  }

  if (!context) return { handled: false };

  const executionCommand = await handleKyrubiaMercadoLivrePublicationExecutionCommand({
    ...input,
    message: commandMessage,
    context,
  });
  if (executionCommand.handled) return executionCommand;

  if (!proposalId) proposalId = proposalIdFromPreparationContext(context);
  if (!proposalId) return { handled: false };

  if (isExplicitPublicationAuthorizationCommand(commandMessage)) {
    const turnContext = refreshedPreparationContext(context);
    try {
      const authorization = await authorizeKyrubiaMercadoLivrePublication({
        storeId: input.userId,
        proposalId,
        authorizedByUserId: input.userId,
      });
      return {
        handled: true,
        turnContext,
        reply: [
          'A autorização explícita do proprietário foi registrada.',
          `O proposal agora está executionStatus=authorized e a autorização ${authorization.authorizationId} ficou disponível por até 15 minutos.`,
          'O segredo interno dessa autorização não é enviado ao navegador; o Firestore guarda somente o hash e a Cairubia continuará apenas com o proposalId como localizador conversacional.',
          'Autorizar ainda não publica: nenhum POST /items foi executado e nenhum anúncio foi criado ou alterado no Mercado Livre.',
          'Se quiser atravessar a última fronteira e executar a publicação real, diga exatamente “Publicar agora”. Esse comando reabrirá a autorização no servidor e a consumirá uma única vez.',
        ].join(' '),
      };
    } catch (error) {
      return {
        handled: true,
        turnContext,
        reply: authorizationUnavailableReply(error),
      };
    }
  }

  const shippingCommand = parseShippingCommand(commandMessage);
  if (shippingCommand) {
    const turnContext = refreshedPreparationContext(context);
    try {
      const readiness = await inspectKyrubiaMercadoLivreCommercialReadiness({
        storeId: input.userId,
        proposalId,
        requestedByUserId: input.userId,
      });
      if (!readiness.allowedShippingModes.includes(shippingCommand.mode)) {
        return {
          handled: true,
          turnContext,
          reply: [
            `O modo “${shippingCommand.mode}” não está entre os modos atualmente compatíveis informados pelo Mercado Livre para esta conta e categoria.`,
            readiness.allowedShippingModes.length
              ? `Escolha um destes: ${readiness.allowedShippingModes.join(', ')}.`
              : 'O provedor não informou nenhum modo compatível neste momento.',
            'Nada foi gravado, validado, autorizado ou publicado.',
          ].join(' '),
        };
      }
      if (shippingCommand.localPickUp && !readiness.localPickUpAvailable) {
        return {
          handled: true,
          turnContext,
          reply: 'A retirada local não está disponível nas preferências atuais dessa conta. O Kyrub não gravou essa escolha e nada foi autorizado ou publicado.',
        };
      }
      const configuration = await configureMercadoLivreOutboundCommercialRequirements({
        storeId: input.userId,
        proposalId,
        saleTerms: [],
        shipping: shippingCommand,
        configuredByUserId: input.userId,
      });
      if (configuration.missingRequiredSaleTermIds.length > 0) {
        return {
          handled: true,
          turnContext,
          reply: [
            `O frete “${shippingCommand.mode}” foi persistido, mas o Mercado Livre ainda exige termo(s) comercial(is): ${configuration.missingRequiredSaleTermIds.join(', ')}.`,
            'O Kyrub bloqueou a validação até esses termos serem coletados com valores oficiais; nenhuma autorização foi criada e nada foi publicado.',
          ].join(' '),
        };
      }
      return {
        handled: true,
        turnContext,
        reply: [
          `O frete foi persistido com modo “${shippingCommand.mode}”, frete grátis=${shippingCommand.freeShipping} e retirada local=${shippingCommand.localPickUp}.`,
          'A escolha foi revalidada contra as preferências oficiais atuais da conta e da categoria antes da gravação.',
          'Nenhuma autorização de publicação foi criada e nenhum anúncio foi publicado.',
          'Agora diga exatamente “Validar draft” para executar somente o gate oficial /items/validate com esse frete.',
        ].join(' '),
      };
    } catch (error) {
      return {
        handled: true,
        turnContext,
        reply: shippingUnavailableReply(error),
      };
    }
  }

  if (!isExplicitDraftValidationCommand(commandMessage)) {
    return { handled: false };
  }

  const turnContext = refreshedPreparationContext(context);
  try {
    const readiness = await inspectKyrubiaMercadoLivreCommercialReadiness({
      storeId: input.userId,
      proposalId,
      requestedByUserId: input.userId,
    });
    if (readiness.missingRequiredSaleTermIds.length > 0) {
      const names = readiness.requiredSaleTerms
        .filter(term => readiness.missingRequiredSaleTermIds.includes(term.id))
        .map(term => `${term.name} (${term.id})`);
      return {
        handled: true,
        turnContext,
        reply: [
          `Ainda faltam termo(s) comercial(is) obrigatório(s) do Mercado Livre: ${names.join(', ') || readiness.missingRequiredSaleTermIds.join(', ')}.`,
          'O Kyrub não chamou /items/validate porque esses dados precisam ser coletados com opções atuais do provedor antes.',
          'Nenhuma autorização foi criada e nada foi publicado.',
        ].join(' '),
      };
    }
    const configuredMode = readiness.configuredShipping?.mode ?? '';
    if (
      !configuredMode ||
      !readiness.allowedShippingModes.includes(configuredMode)
    ) {
      if (readiness.allowedShippingModes.length === 0) {
        return {
          handled: true,
          turnContext,
          reply: [
            'O Mercado Livre não informou nenhum modo de frete compatível entre as preferências desta conta e desta categoria.',
            `Modos da conta: ${readiness.sellerShippingModes.join(', ') || 'nenhum'}. Modos da categoria: ${readiness.categoryShippingModes.join(', ') || 'nenhum'}.`,
            'O Kyrub não chamou /items/validate e não vai inventar um modo. Ajuste as opções logísticas da conta no Mercado Livre e tente novamente.',
            'Nenhuma autorização foi criada e nada foi publicado.',
          ].join(' '),
        };
      }
      return {
        handled: true,
        turnContext,
        reply: shippingSelectionReply({
          allowedModes: readiness.allowedShippingModes,
          localPickUpAvailable: readiness.localPickUpAvailable,
        }),
      };
    }

    const validation = await validateKyrubiaMercadoLivreDraftListing({
      storeId: input.userId,
      proposalId,
      validatedByUserId: input.userId,
    });

    if (validation.status === 'ready_for_owner_authorization') {
      return {
        handled: true,
        turnContext,
        reply: [
          `O Mercado Livre respondeu ${validation.providerStatus} ao /items/validate: o payload persistido foi aceito no gate de validação.`,
          'Registrei a evidência como ready_for_owner_authorization com autoridade provider_items_validate.',
          'Isso não é autorização de publicação: executionStatus continua not_authorized, nenhuma autorização de execução foi criada e nenhum item foi publicado.',
          'Se você realmente quiser criar a autorização one-time para este payload já validado, diga exatamente “Autorizar publicação”. Esse comando ainda não publica o item.',
        ].join(' '),
      };
    }

    const visibleCauses = validation.causes.slice(0, 5).map(compactCause).filter(Boolean);
    const causeText = visibleCauses.length
      ? ` O Mercado Livre apontou: ${visibleCauses.join(' | ')}.`
      : ` O Mercado Livre respondeu ${validation.providerStatus}, mas não devolveu uma causa estruturada utilizável.`;
    return {
      handled: true,
      turnContext,
      reply: [
        `O /items/validate respondeu ${validation.providerStatus} e o draft ficou como needs_correction.`,
        causeText,
        'O Kyrub bloqueou qualquer avanço para autorização real; nenhuma autorização de publicação foi criada e nenhum item foi publicado.',
        'Essas causas agora podem ser tratadas em um fluxo de correção do draft antes de uma nova validação.',
      ].join(' '),
    };
  } catch (error) {
    return {
      handled: true,
      turnContext,
      reply: validationUnavailableReply(error),
    };
  }
};
