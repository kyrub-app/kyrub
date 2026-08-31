export const KYRUB_CATALOG_DRAFT_SCHEMA_VERSION = 1 as const;

export type KyrubCatalogDraftStatus = 'draft' | 'published' | 'discarded';

export type KyrubCatalogDraftSourceKind =
  | 'conversation'
  | 'manual'
  | 'image'
  | 'pdf'
  | 'catalog_analysis'
  | 'mercado_livre';

export type KyrubCatalogDraftField =
  | 'name'
  | 'description'
  | 'price'
  | 'stock'
  | 'category'
  | 'image'
  | 'isService'
  | 'isComplimentary';

export type KyrubCatalogDraftFieldProvenance =
  | 'user_intent'
  | 'quoted_content'
  | 'document_content'
  | 'tool_output'
  | 'ai_generated_content'
  | 'sensor_inference';

export type KyrubCatalogDraftIssueCode =
  | 'missing_required_field'
  | 'possible_duplicate'
  | 'ambiguous_value'
  | 'unreadable_source';

export type KyrubCatalogDraftIssue = {
  code: KyrubCatalogDraftIssueCode;
  field?: KyrubCatalogDraftField;
  message: string;
};

export type KyrubCatalogDraftProductInput = {
  name: string;
  description?: string;
  price?: number;
  stock?: number;
  category?: string;
  image?: string;
  isService?: boolean;
  isComplimentary?: boolean;
};

export type KyrubCatalogDraftSource = {
  kind: KyrubCatalogDraftSourceKind;
  conversationId?: string;
  sourceRefs?: string[];
};

export type KyrubCatalogProductDraft = {
  schemaVersion: typeof KYRUB_CATALOG_DRAFT_SCHEMA_VERSION;
  id: string;
  ownerUid: string;
  storeId: string;
  canonicalStoreId?: string;
  status: KyrubCatalogDraftStatus;
  source: KyrubCatalogDraftSource;
  product: KyrubCatalogDraftProductInput;
  fieldProvenance: Partial<
    Record<KyrubCatalogDraftField, KyrubCatalogDraftFieldProvenance>
  >;
  issues: KyrubCatalogDraftIssue[];
  createdAtIso: string;
  updatedAtIso: string;
  publishedProductId?: string;
};

export type KyrubCatalogDraftListItem = Pick<
  KyrubCatalogProductDraft,
  | 'id'
  | 'storeId'
  | 'canonicalStoreId'
  | 'status'
  | 'source'
  | 'product'
  | 'issues'
  | 'createdAtIso'
  | 'updatedAtIso'
>;

export type KyrubCatalogDraftListResponse = {
  drafts: KyrubCatalogDraftListItem[];
};
