# Roadmap Mestre do Kyrub

Este documento organiza o desenvolvimento por capacidades e gates. Ideias novas devem ser encaixadas na fase correta, sem interromper automaticamente o bloco em execução.

## Fase 0 — Fundação técnica — concluída

Aplicação React/TypeScript, autenticação, Firebase/Firestore/Storage, Vercel, regras, usuários e loja por usuário.

## Fase 1 — Produto manual — concluída

Fluxos principais permanecem utilizáveis sem IA. Kyrubia é uma porta adicional, não substituição da interface manual.

## Fase 2 — Kyrubia conversacional — concluída no núcleo

Conversação, contexto, multimodalidade, notas/tarefas e continuidade entre turnos.

## Fase 3 — Camada Oficial de Ações — concluída no núcleo

Propostas estruturadas, policy engine, confirmação, execução segura, idempotência e recibos autoritativos.

## Fase 3.9 — Kyrubia como plataforma externa — em desenvolvimento

Objetivo: disponibilizar capacidades do Kyrub via MCP/API para agentes externos.

- 3.9.1 contrato público de ferramentas;
- 3.9.2 servidor MCP Streamable HTTP;
- 3.9.3 OAuth, escopos, consentimento e revogação;
- 3.9.4 read-only externo;
- 3.9.5 escritas seguras pela Camada Oficial de Ações;
- 3.9.6 experiência “Conecte sua IA”.

Detalhes: `docs/KYRUBIA_EXTERNAL_MCP.md`.

## Fase 4 — ERP conversacional completo — fase principal atual

### 4.0 — Observabilidade e governança de IA

- identificar modelo, duração, chamadas, tokens e erro por interação;
- distinguir 429/quota, timeout, 5xx, tool calling e falha interna;
- alimentar posteriormente o Control Plane.

### 4.1 — Estoque

- consistência pós-escrita;
- entrada, consulta, saída, ajuste e perda;
- movimentações autoritativas;
- estoque mínimo, unidades e custos.

### 4.2 — Ficha técnica

- produto -> insumos e quantidades;
- capacidade produtiva;
- custo de composição.

### 4.3 — Venda/pedido -> estoque

- consumo automático pela ficha técnica;
- estorno e cancelamento com trilha própria.

### 4.4 — Custos e precificação

- custo unitário;
- margem;
- impacto de alteração de insumos;
- preço sugerido com hipóteses explícitas.

### 4.5 — Pedidos completos

Leituras e mutações operacionais oficiais.

### 4.6 — Catálogo completo

Rascunho/publicação, campos editáveis, preço, mídia, disponibilidade e contratos únicos.

### 4.7 — Loja e operação

Completar capacidades de perfil e configurações operacionais.

## Fase 5 — Inteligência operacional e consultiva

Lente de Oportunidades, alertas, relações entre dados, anomalias, previsões e recomendações contextualizadas.

## Fase 6 — Monetização e Control Plane

Planos, entitlements, consumo de IA, custos, Firestore/Storage, upgrades e governança comercial.

## Fase 7 — Ecossistema

Radar, fidelidade, Ads, B2B, agenda/reservas, integrações, pagamentos e entregas.


### 7.T — Família Kyrub Tag: dispositivos físicos e rede de revenda

- **7.T.1 — identidade individual:** ID permanente por acessório; vínculo definitivo ao primeiro titular mediante código secreto de ativação separado; conteúdo modificável pelo titular; acesso público revogável por unidade; múltiplos acessórios por conta. Sem transferência ou reaproveitamento do identificador, inclusive após desativação.
- **7.T.2 — produto e fabricação:** Kyrub Tag é a família; Pitanga é o primeiro modelo de chaveiro. Outros modelos: pulseira, cartão e adesivo (on-metal quando aplicável). Tag econômica com URI NDEF bloqueada na fabricação; não é anticlonagem. Versão avançada com autenticação criptográfica e proteção contra replay sujeita a validação de hardware. Kyrub Link e HCE são frentes separadas.
- **7.T.3 — Loja Oficial e Renda:** cadastrar SKUs e lotes, custo integral, estoque serializado, venda unitária e atacado, revendedores parceiros, rastreabilidade por lote e devoluções/garantia. Preços de referência NÃO aprovados nem publicados: custo estimado R$ 5, parceiro R$ 8, varejo sugerido R$ 15; custo de R$ 5 para ações subsidiadas, sujeito a orçamento. Não exigir ERP próprio para revenda; definir regras comerciais, fiscais e de elegibilidade.
- **7.T.4 — campanhas e premiações:** distribuição de cortesia, aquisição, recompensas físicas por XP conforme regras aprovadas e estoque disponível. Não emitir Pitangas/XP automaticamente por ativação; financiamento e trilha de auditoria separados.
- **7.T.5 — emergência:** dados voluntários e atualizáveis, consentimento específico revogável, contato autorizado, informação declarada (não substitui avaliação médica), sem CPF/RG/endereço. Não gravar dados sensíveis no chip; avaliar LGPD, proteção de menores e acesso, QR e modo offline em fase própria antes da implementação. Sem promessa de atendimento ou socorro.
- **7.T.6 — gate comercial:** validar provisionamento, autenticação, concorrência, recusa de transferência, isolamento entre contas, desativação seletiva, revogação de consentimento, compatibilidade física e custo real antes de fabricar em escala/vender. Nenhum lote, preço, pagamento ou campanha ativado por esta PR.

## Fase 8 — Escala e autonomia

Equipe, permissões, automações, autonomia graduada, auditoria completa, concorrência e plataforma para terceiros.

## Regra de gate

Um bloco só é concluído quando existe prova do ciclo relevante. Para ações: interpretar -> propor -> autorizar -> executar -> persistir -> reler -> auditar. Para integrações: autenticar -> listar capacidades -> executar dentro do escopo -> revogar acesso -> provar isolamento entre usuários.
