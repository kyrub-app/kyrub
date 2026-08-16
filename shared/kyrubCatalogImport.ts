import type { KyrubCatalogAnalysisSourceKind } from './kyrubCatalogAnalysis';

export type KyrubCatalogImportDraftItem = {
  ref: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  category: string;
  isService: boolean;
};

export type KyrubCatalogImportDraftProposal = {
  id: string;
  type: 'import_catalog_draft';
  conversationId: string;
  sourceKind: KyrubCatalogAnalysisSourceKind;
  items: KyrubCatalogImportDraftItem[];
  skippedForReview: number;
  requiresConfirmation: true;
};

export type KyrubCatalogImportDraftResult = {
  status: 'success' | 'already_applied';
  createdCount: number;
  alreadyAppliedCount: number;
  productIds: string[];
};
