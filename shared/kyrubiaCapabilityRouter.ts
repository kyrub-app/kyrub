export type KyrubiaCapabilityIntent =
  | 'create_note'
  | 'create_task'
  | 'create_products'
  | 'analyze_catalog'
  | 'transcribe_text'
  | 'generate_image'
  | 'read_erp'
  | 'conversation';

export type KyrubiaCapabilityDecision = {
  primary: KyrubiaCapabilityIntent;
  mutation: 'none' | 'note' | 'task' | 'products';
};

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const NOTE_NOUN = /\b(nota|notas|anotacao|anotacoes)\b/;
const NOTE_WRITE = /\b(crie|criar|cria|adicione|adicionar|salve|salvar|registre|registrar|guarde|guardar|anote|anotar)\b/;
const TASK_NOUN = /\b(tarefa|tarefas|lembrete|lembretes|checklist)\b/;
const TASK_WRITE = /\b(crie|criar|cria|adicione|adicionar|agende|agendar|lembre|lembrar|registre|registrar)\b/;
const PRODUCT_NOUN = /\b(produto|produtos|item|itens|cardapio|catalogo|menu|vitrine)\b/;
const PRODUCT_WRITE = /\b(cadastre|cadastrar|cadastro|recadastre|recadastrar|adicione|adicionar|inclua|incluir|importe|importar|crie|criar|publique|publicar|atualize|atualizar)\b/;
const TRANSCRIBE = /\b(transcreva|transcrever|transcricao|copie o texto|copiar o texto|extraia o texto|extrair o texto|leia o texto|ler o texto)\b/;
const IMAGE_NOUN = /\b(imagem|foto|ilustracao|arte|banner|logo|logotipo|icone)\b/;
const IMAGE_GENERATE = /\b(gere|gerar|crie|criar|desenhe|desenhar|produza|produzir)\b/;
const CATALOG_NOUN = /\b(cardapio|catalogo|menu|lista de precos|produtos|itens)\b/;
const ANALYZE = /\b(analise|analisar|organize|organizar|identifique|identificar|extraia|extrair)\b/;
const ERP_READ = /\b(quantos|quais|liste|listar|mostre|mostrar|consulte|consultar|estoque|pedido|pedidos|produtos cadastrados|itens cadastrados)\b/;

export const classifyKyrubiaCapability = (
  message: string
): KyrubiaCapabilityDecision => {
  const text = normalize(message);

  // Explicit target nouns outrank broad verbs such as “crie”. This keeps
  // “crie uma nota sobre o cardápio” distinct from “cadastre o cardápio”.
  if (TASK_NOUN.test(text) && TASK_WRITE.test(text)) {
    return { primary: 'create_task', mutation: 'task' };
  }
  if (NOTE_NOUN.test(text) && NOTE_WRITE.test(text)) {
    return { primary: 'create_note', mutation: 'note' };
  }
  if (PRODUCT_NOUN.test(text) && PRODUCT_WRITE.test(text)) {
    return { primary: 'create_products', mutation: 'products' };
  }

  // Read-only intents never inherit a mutation just because a writable tool
  // exists elsewhere in the runtime.
  if (TRANSCRIBE.test(text)) {
    return { primary: 'transcribe_text', mutation: 'none' };
  }
  if (IMAGE_NOUN.test(text) && IMAGE_GENERATE.test(text)) {
    return { primary: 'generate_image', mutation: 'none' };
  }
  if (CATALOG_NOUN.test(text) && ANALYZE.test(text)) {
    return { primary: 'analyze_catalog', mutation: 'none' };
  }
  if (ERP_READ.test(text)) {
    return { primary: 'read_erp', mutation: 'none' };
  }

  return { primary: 'conversation', mutation: 'none' };
};

export const kyrubiaIntentAllowsAction = (
  decision: KyrubiaCapabilityDecision,
  actionType: string
): boolean => {
  if (actionType === 'create_note') return decision.mutation === 'note';
  if (actionType === 'create_task') return decision.mutation === 'task';
  if (
    actionType === 'create_product' ||
    actionType === 'prepare_product_draft' ||
    actionType === 'import_catalog_draft' ||
    actionType === 'update_product'
  ) {
    return decision.mutation === 'products';
  }
  return decision.mutation !== 'none';
};
