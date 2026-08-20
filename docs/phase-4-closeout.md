# Fase 4 — ERP Conversacional Completo — ENCERRADA

Status: **CONCLUÍDA**

Marco funcional de fechamento: `cf438ea65c702623a3b189a04a9960bcd1df137c`

## Objetivo encerrado

A Fase 4 transforma a Kyrubia de uma camada principalmente consultiva em uma interface conversacional capaz de ler o ERP real e preparar/executar mutações empresariais pelo mesmo mecanismo oficial, autenticado e auditável usado pelo Kyrub.

O fechamento desta fase significa que os domínios definidos para o ERP conversacional não dependem de gravações paralelas, bypasses da interface ou confiança em texto gerado pelo modelo.

## Blocos entregues

### 4.0 — Observabilidade e resiliência do provedor

- classificação estruturada de falhas do Gemini;
- distinção entre quota, timeout, 4xx, 5xx, autenticação, rede e falha de tool call;
- seleção de modelo e fallback por quota;
- medição de uso e custo das respostas processadas;
- envelope de erro preservado até o cliente;
- mensagem específica para indisponibilidade por quota.

### 4.1 — Camada Oficial de Ações

- registro central de ações;
- separação explícita entre leitura e escrita;
- política de autorização e confirmação;
- envelope de execução autenticado;
- idempotência, expiração e proteção contra replay/stale state;
- impacto e blast radius declarados.

### 4.2 — Estoque conversacional

- entrada, saída, perda e correção de estoque por linguagem natural;
- confirmação humana para mutações;
- movimentações privadas e auditáveis;
- rejeição de saldo insuficiente e dados inexistentes;
- nenhuma criação/publicação implícita de produto.

### 4.3 — Ficha técnica e composição

- composição de produto/receita pela Camada Oficial de Ações;
- vínculo com insumos reais;
- quantidade e unidade explícitas;
- confirmação antes da persistência;
- proteção contra referências inventadas.

### 4.4 — Consumo de estoque por venda

- integração entre pedido confirmado e consumo de composição;
- idempotência de consumo;
- proteção contra consumo duplicado;
- bloqueio quando a operação não pode ser aplicada com segurança.

### 4.5 — Pedidos

- leitura conversacional de pedidos;
- alteração de status pela ação oficial;
- estado esperado para proteção anti-stale;
- confirmação humana antes da mutação;
- nenhuma decisão operacional inferida como já executada.

### 4.6 — Catálogo completo

- criação e atualização de produto;
- rascunho/importação de catálogo;
- publicação/rascunho;
- ajustes de dados do produto;
- confirmação e contratos de segurança;
- dados do catálogo tratados como entidades reais, não como texto de conversa.

### 4.7 — Loja e operação

- sincronização canônica do perfil/vitrine após `update_store_profile`;
- status operacional da loja;
- horários de funcionamento;
- parser determinístico para comandos operacionais simples;
- confirmação humana em modal específico;
- execução no endpoint autoritativo `/api/action-execute`;
- integrações, credenciais e IDs externos mantidos fora do comando conversacional operacional.

## Invariantes de fechamento

1. A Kyrubia pode propor; mutações relevantes não são consideradas executadas antes da confirmação e da resposta autoritativa.
2. O modelo não é fonte de verdade para estoque, catálogo, pedidos ou estado da loja.
3. Escritas do ERP passam pela Camada Oficial de Ações e suas políticas.
4. Operações sensíveis usam autenticação, autorização, anti-stale e idempotência.
5. O modo manual do Kyrub continua disponível.
6. Integrações externas não recebem autorização implícita por conversa.
7. O snapshot do ERP é contexto de leitura, nunca autorização de escrita.
8. Falha do provedor de IA não deve converter uma operação não executada em sucesso aparente.

## Validação do marco

A PR de fechamento funcional da Fase 4 (`#209`) passou pelos gates obrigatórios antes do merge:

- Application build: **verde**;
- Validate Kyrub: **verde**;
- MVP readiness: **verde**;
- TypeScript: **verde**;
- Contract tests: **verde**;
- Bundle: **verde**.

O commit `cf438ea65c702623a3b189a04a9960bcd1df137c` foi publicado em produção e sincronizado com a branch fixa de Preview.

## A partir daqui

Novos trabalhos deixam de alterar o escopo da Fase 4. Correções encontradas em Release Candidate são classificadas como **hardening de lançamento**; novas capacidades pertencem às fases seguintes.

O hardening pode ampliar telemetria, UX de erro, observabilidade, smoke tests e proteção operacional sem reabrir o escopo funcional da Fase 4.

---

**Decisão:** Fase 4 — ERP Conversacional Completo — **ENCERRADA**.
