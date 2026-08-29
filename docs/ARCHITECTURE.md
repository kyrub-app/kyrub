# Arquitetura do Kyrub

## Visão geral

Kyrub é uma plataforma operacional única, implementada em React/TypeScript no cliente, Node/Express no desenvolvimento e funções serverless em produção. As experiências de vitrine, ERP/PDV, CRM, fidelidade, atendimento local, retirada, delivery, pagamentos, comunicação, social e Kyrubia devem reutilizar as mesmas autoridades canônicas em vez de criar estados paralelos.

A direção arquitetural é o **Kyrub Operation Engine**, organizado em domínios compartilhados:

1. Identity & Relationships;
2. Catalog & Resources;
3. Commitments / Orders;
4. Fulfillment;
5. Payments & Settlements;
6. Domain Events & Receipts;
7. Policy & Permissions;
8. Communication & Social;
9. Kyrubia / Trusted Actions.

Uma experiência de produto é uma projeção desses domínios. Ela não recebe autorização para inventar uma nova fonte de verdade só porque precisa de uma nova tela.

## Superfícies principais

### Aplicativo autenticado

É a superfície pessoal do usuário Kyrub. A mesma identidade humana pode comprar, operar a própria loja e, quando houver vínculo autorizado, atuar em outra loja.

### Loja / vitrine pública

A loja é uma identidade institucional e comercial. Ela possui apresentação pública própria, mas **não é um segundo login compartilhado**. Uma ação institucional preserva simultaneamente:

- o principal da loja;
- o usuário humano autenticado;
- o papel/capability que autorizou a representação.

### Control Plane administrativo

O Admin é uma superfície separada, com autorização administrativa adicional. Finance, operações, credenciais, governança e observabilidade não são liberados apenas porque o usuário está autenticado no Kyrub comum.

## Entradas da aplicação

### `src/main.tsx`

Monta a árvore React, bridges transversais e a barreira de recuperação de erros.

### `src/App.tsx`

Resolve as superfícies administrativas, públicas e autenticadas e mantém a composição compatível com a aplicação histórica.

### `src/LegacyApp.tsx`

Ainda concentra parte relevante da composição legada. A estratégia de migração é extrair regras e capacidades para módulos, serviços, contratos compartilhados e bridges testáveis, sem reescrever o produto inteiro de uma vez.

Nova regra de desenvolvimento: **não ampliar o monólito quando a capacidade puder viver no domínio compartilhado**.

## Identity & Relationships

Firebase Authentication identifica a pessoa. O documento `users/{uid}` mantém o perfil mínimo necessário ao produto e aos diretórios sujeitos às regras de visibilidade.

A loja é um principal institucional derivado da loja canônica. Representar uma loja exige uma identidade humana autenticada e uma autorização válida. A evolução de staff deve usar membership/vínculo + role + capability, nunca credenciais compartilhadas de estabelecimento.

Relacionamento cliente ↔ loja é derivado de fatos canônicos — compras confirmadas, Pontos da Loja, desafios, recompensas e outras interações autorizadas. CRM é uma **projeção operacional**, não uma coleção em que o operador pode editar manualmente saldo, número de compras ou histórico econômico.

## Catalog & Resources

O catálogo canônico é reutilizado por vitrine, PDV e integrações. Produtos preservam regras de estoque, customizações, composição e, quando configurado, a pontuação de fidelidade que será fotografada no momento da compra.

Canais externos devem ser tratados como `StoreConnection`/adapters. Marketplaces não se tornam autoridade interna por acidente. Importação e sincronização precisam declarar provenance e sync authority.

## Commitments / Orders

O caminho canônico de pedidos operacionais é store-scoped:

`/stores/{storeId}/orders/{orderId}`

Durante a migração ainda existe compatibilidade com caminhos legados em `/artifacts`. Para pedidos novos de clientes, quando o mapeamento canônico existe, a gravação nasce canônica e mantém o espelho legado temporário com o mesmo `orderId`.

A leitura prefere o registro canônico e usa legado somente como fallback/reconciliação enquanto a migração não for encerrada. O watcher legado não pode sobrescrever um estado canônico igual ou mais novo.

Pedidos de consumo local (`dine_in`), retirada (`pickup`) e entrega (`delivery`) compartilham o mesmo domínio de compromisso, ainda que cada modalidade possua regras de fulfillment diferentes.

## Atendimento local e retirada

Atendimento Local é uma projeção de pedidos canônicos `dine_in` e `pickup`; não mantém uma segunda coleção de pedidos.

Retirada segura preserva a regra:

1. produção pode marcar o pedido como pronto;
2. `ready` não significa entregue;
3. a conclusão de pickup exige o handoff autorizado;
4. o servidor valida o código de segurança;
5. somente então o handoff é confirmado.

## Payments

O navegador nunca é autoridade para declarar `paid`.

Fluxo marketplace simplificado:

`checkout -> PaymentIntent pending -> PSP -> evento verificado -> webhook Kyrub -> pagamento canônico -> materialização operacional`

Delivery/pickup online criam primeiro um `PaymentIntent` server-side. O valor e os itens relevantes são validados pelo servidor contra o catálogo; o browser não pode declarar preço autoritativo.

Somente um evento de provedor verificado e normalizado pode promover o pagamento conforme o contrato do provider. O webhook usa idempotência e é a fronteira compartilhada para efeitos derivados de um pagamento realmente confirmado.

## Economic Ledger

Pagamento e economia são conceitos relacionados, mas distintos.

O ledger econômico canônico registra fatos imutáveis como:

- captura;
- refund;
- chargeback debitado;
- reversão de chargeback;
- fotografia econômica de taxas e subsídios quando aplicável.

Refund, cancelamento e chargeback não são sinônimos e não reescrevem lançamentos históricos. Reversões criam fatos compensatórios.

A taxa de entrega paga pelo cliente é economicamente destinada 100% ao entregador. Subsídio da loja, incentivo Kyrub, subsídio de parceiro, custos observados/PSP e margem Kyrub permanecem fatos separados.

**Ledger econômico não é wallet, custódia nem settlement.** O próximo domínio financeiro deve evoluir explicitamente por:

`Payment -> Allocation -> Obligation -> Settlement -> Reconciliation`

Até existir um rail autorizado, uma obrigação de pagamento não pode ser apresentada como dinheiro liquidado.

## Store Points, desafios e recompensas

Pontos da Loja são uma economia própria. Eles não são K-Coins, XP nem saldo financeiro.

No pagamento confirmado:

- a regra `storePointsPerUnit` já foi fotografada pelo servidor no contexto da compra;
- quantidade × regra fotografada gera o lançamento base;
- bônus são lançamentos separados;
- estornos são movimentos compensatórios;
- mudança posterior na regra do produto não recalcula compra antiga.

Desafios e recompensas da loja reutilizam esse relacionamento sem converter automaticamente Store Points em K-Coins ou XP.

## CRM, comunicação e campanhas

CRM deriva seus números das fontes canônicas. Comunicação possui preferências/consentimentos próprios; uma campanha não pode ignorar opt-out só porque um cliente aparece no CRM.

Chat cliente ↔ loja e notificações preservam autoria, identidade institucional e identidade humana quando necessário.

## Fulfillment & Delivery

Delivery é um fulfillment do pedido canônico, não um sistema de pedidos independente.

O domínio de entrega prepara oportunidades/jobs ligados ao `sourceOrderId`, claims idempotentes e tracking sujeito à autorização. Localização em tempo real só pode ser exposta a participantes autorizados enquanto o tracking estiver ativo.

Providers externos de entrega devem entrar por adapter e nunca substituir o pedido Kyrub como fonte de verdade.

## Estoque e produção

Depois da fronteira de pagamento/pedido, o mesmo pedido alimenta inbox/KDS e reconciliação de estoque. Customizações e impactos de opções devem chegar ao consumo de inventário sem perder a linhagem do item vendido.

A interface não pode concluir pagamento, inventário ou entrega por inferência visual.

## Firestore e migração

Firestore é a persistência compartilhada entre dispositivos. As rules são compostas por scripts e testadas com Firebase Emulator.

Princípios:

- caminhos privados exigem ator autorizado;
- diretórios públicos expõem somente campos permitidos;
- Admin SDK existe apenas no servidor;
- cliente não recebe permissão implícita para escrever ledgers server-only;
- paths legados permanecem somente enquanto a estratégia de cutover exigir;
- decisões de leitura canônica/fallback e reconciliação são testadas.

Offline cache melhora continuidade, mas nunca concede autorização nem vira fonte canônica.

## Servidor e funções de produção

`server.ts` compõe o servidor Node usado localmente e os routers compartilhados. `api/` contém handlers adequados à Vercel.

O projeto normaliza e valida o grafo ESM serverless antes do deploy para impedir que imports relativos válidos no TypeScript quebrem no runtime Node da Vercel.

Segredos são resolvidos no servidor/Vault. Token, chave ou credencial integral não deve retornar ao browser, log ou Firestore comum.

## Kyrubia / Trusted Actions

Kyrubia é uma camada operacional sobre o mesmo produto; ela não possui um backend privilegiado paralelo.

Capacidades já evoluíram além de `create_note` e incluem leituras determinísticas, notas/tarefas, ações de catálogo/produto, preparação de rascunhos, contexto multimodal, recibos autoritativos e outras ações registradas no Action Engine.

Invariantes:

1. contexto observado não concede permissão de escrita;
2. ações passam por registro/contrato conhecido;
3. backend autentica e autoriza o ator;
4. confirmação humana é aplicada quando a policy exige;
5. execução usa idempotência;
6. resultado relevante produz receipt/evidência autoritativa;
7. a Kyrubia só afirma sucesso quando há confirmação suficiente, não porque viu um clique;
8. UI manual continua disponível.

A evolução para Operations API/MCP deve expor somente as mesmas capacidades permissionadas e auditáveis.

## Observabilidade e receipts

Eventos observados no cliente são contexto, não prova de resultado. Ações confirmadas preservam outra autoridade (`authoritative_write_ack`/`server_confirmed`) e podem ser revalidadas por receipt associado ao ator, ação, proposta e entidade corretos.

Pagamentos e ledgers preservam IDs determinísticos, provider event e correlation/idempotency keys para permitir auditoria e replay seguro.

## Control Plane / Platform Economy

O painel econômico administrativo é uma projeção server-authorized do ledger econômico. Ele distingue captura, refund, chargeback e reversão e não apresenta esses números como wallet ou settlement.

Acesso financeiro depende de permissão administrativa apropriada e deve gerar auditoria.

## Segurança

Fronteiras obrigatórias:

- Firebase Auth para identidade;
- membership/roles/capabilities para autorização institucional;
- Firestore/Storage Rules para acesso direto permitido;
- Admin SDK somente em backend confiável;
- provider webhook verificado para autoridade financeira;
- idempotência/replay protection em efeitos críticos;
- Vault/ENV para segredos;
- rate limits e gates de entitlement quando aplicáveis;
- dependency audit como parte da regressão de release.

## Testes e release

A definição de pronto é:

`canonical model -> authorization -> server authority -> persistence -> projection/UI -> tests -> integration -> production validation`

A suíte combina:

- `tsc --noEmit`;
- testes Node de domínio/contrato;
- contratos cross-domain;
- Firebase Emulator para Firestore/Storage Rules;
- validações de migração/cutover;
- build cliente + servidor;
- normalização e validação do grafo ESM serverless;
- dependency security audit;
- release gate que diferencia PR verde, merge e produção real.

Um PR verde significa **implementation-ready**, não `production-complete`.

## Direção de evolução

1. concluir a validação integrada antes de promover a grande onda atual;
2. fechar o domínio de obligations/settlements antes de criar wallet autoritativa;
3. consolidar memberships e capacidades de staff;
4. manter omnichannel como adapters sobre catálogo/pedidos canônicos;
5. evoluir delivery sobre o mesmo order/fulfillment engine;
6. centralizar disputas e resolução em fatos compensatórios;
7. completar governance/legal e gates de compliance;
8. conectar Kyrubia e agentes externos ao mesmo Policy/Action Engine;
9. continuar reduzindo responsabilidades do `LegacyApp` sem quebrar contratos existentes.
