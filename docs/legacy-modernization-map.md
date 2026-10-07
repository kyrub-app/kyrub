# Mapa de modernização do legado Kyrub

Base auditada: `main@f3064725ee90ec0cd17c33d604dc6e143d444669`.

## Regra da auditoria

O nome `Bridge` não significa automaticamente dívida. A classificação deve responder a duas perguntas:

1. quem é o dono autoritativo do estado e da regra de negócio?
2. a bridge cruza uma fronteira legítima (provedor externo, sincronização, observabilidade) ou apenas faz uma UI/camada nova controlar uma implementação interna antiga?

Nenhuma remoção deve acontecer apenas pelo nome do arquivo.

## Fotografia inicial

- 514 arquivos TypeScript/TSX em `src`.
- 102 arquivos nomeados `*Bridge.ts(x)`.
- 12 arquivos explicitamente nomeados com `Legacy`/legacy.
- `App.tsx` ainda monta `LegacyApp` como workspace autenticado principal.
- `LegacyApp` ainda possui estado de navegação e estado de vários domínios, e renderiza `KyrubTab`.
- `KyrubTab` envolve `LegacyKyrubTab`; portanto a camada social nova ainda depende estruturalmente da camada social antiga.
- `App.tsx` documenta explicitamente que `LegacyApp` ainda é dono do bootstrap inicial da loja privada.
- `main.tsx` e `App.tsx` montam dezenas de bridges globais ao redor do app, o que exige classificação antes de remoção.

## Legado explicitamente nomeado

- `src/LegacyApp.tsx`
- `src/ai/catalogDraftRuntimeLegacy.ts`
- `src/ai/operationalWorkflowRuntimeLegacy.ts`
- `src/components/LegacyRetailerPanel.tsx`
- `src/components/LegacyStorefrontPanel.tsx`
- `src/components/customer/LegacyTableServiceWorkspace.tsx`
- `src/components/modals/LegacyB2CCartDrawer.tsx`
- `src/components/modals/LegacyNewProductModal.tsx`
- `src/components/modals/LegacyStoreConfigModal.tsx`
- `src/components/store/StorePromotionsLegacyBridge.tsx`
- `src/components/tabs/LegacyKyrubTab.tsx`
- `src/utils/legacyTableOperations.ts`

## Mapa por domínio — primeira classificação

| Domínio | Autoridade antiga confirmada | Camada mais nova observada | Situação | Prioridade |
| --- | --- | --- | --- | --- |
| Shell/navegação autenticada | `LegacyApp` | `App`, `WorkspacePrimaryNavigationBridge`, guards | Estado novo ainda comanda shell antigo | Crítica |
| Social/Praça/Marketplace | `LegacyApp` + `LegacyKyrubTab` | `KyrubTab`, `ProfileSocialHubNative`, bridges Profile/Social | Dupla autoridade e navegação indireta | Crítica / primeiro domínio |
| Pessoal/Perfil | partes do perfil antigo + DOM existente | `ProfileSocialHubNative` e várias Profile*Bridge | camada nova existe, mas vários patches ainda observam/injetam DOM | Alta |
| Comunidades | host ainda descoberto/injetado no modal por DOM | `ProfileCommunitiesCloudBridge` + `communityCloud` | dados cloud modernos, montagem ainda acoplada ao DOM do perfil | Alta |
| Loja/ERP | bootstrap de loja explicitamente ainda pertence ao `LegacyApp` | Retailer/Store workspace + várias store bridges | autoridade precisa ser separada por subdomínio | Crítica |
| Produtos | modais/painéis legacy ainda existem | unified product modal, sync e product bridges | migração parcial | Alta |
| PDV/atendimento | operações e workspace legacy ainda existem | bridges operacionais/PDV | migração parcial; risco operacional | Alta |
| Pagamentos/recebíveis | não classificado como legado apenas pelo nome | Mercado Pago/Pix bridges e contratos atuais | bridges externas podem ser fronteiras legítimas | Preservar até auditoria |
| Fiscal | não há Legacy explícito no nome do núcleo atual | bridges/workspaces fiscais atuais | não remover por heurística | Preservar até auditoria |
| Integrações externas | — | Mercado Livre, 99Food, OAuth etc. | bridge pode ser arquitetura correta de fronteira | Preservar |
| IA/Kyrubia | dois runtimes explicitamente Legacy | runtimes/actions atuais e bridges IA | autoridade duplicada a mapear | Alta |
| Observabilidade | — | observer/log/receipt bridges | infraestrutura transversal provavelmente legítima | Preservar até auditoria |

## Padrões de risco já confirmados

### A. Nova UI comandando UI antiga

`WorkspacePrimaryNavigationBridge` encontra elementos do DOM, marca botões, intercepta clique em capture, fecha/abre superfícies e historicamente simulou cliques para chegar a Praça/Ofertas. Isso é bridge de compatibilidade interna e deve desaparecer quando o shell canônico assumir a navegação.

### B. Nova camada envolvendo componente Legacy

`components/tabs/KyrubTab.tsx` usa `LegacyKyrubTab`. O wrapper adiciona recursos atuais, mas a tela/base e seus estados ainda pertencem ao componente legado. O objetivo é inverter essa relação: a implementação atual deve ser dona da tela e importar apenas serviços/hooks reutilizáveis.

### C. DOM como API interna

`ProfileCommunitiesCloudBridge` usa `MutationObserver`, procura o modal do perfil, encontra input por seletor/placeholder, cria mount com `document.createElement` e injeta conteúdo via portal. Os dados de comunidade são atuais, mas a composição visual ainda depende de uma API implícita de DOM. Deve virar composição React explícita.

### D. LegacyApp como service locator/state owner

Além de renderizar a UI, `LegacyApp` mantém estados de navegação e múltiplos domínios. `App.tsx` também registra que ele ainda controla o bootstrap inicial da loja. Enquanto isso continuar, substituir apenas componentes visuais não elimina a dependência estrutural.

## Critério de destino

Cada item será marcado em uma das quatro classes:

- **CANÔNICO** — dono atual do estado/regra; manter e fortalecer.
- **FRONTEIRA** — bridge legítima para serviço externo, sincronização, observabilidade ou compatibilidade inevitável; manter com contrato explícito.
- **TRANSIÇÃO** — bridge temporária entre implementação atual e antiga; deve receber plano de retirada.
- **LEGADO AUTORITATIVO** — código antigo ainda é dono do estado/regra; precisa ter autoridade migrada antes de ser removido.

## Ordem de migração proposta

1. **Social/Pessoal/Praça/Marketplace**: definir um único estado de navegação social e eliminar dependência de `LegacyKyrubTab`/cliques/DOM para navegar.
2. **Shell do aplicativo**: retirar gradualmente de `LegacyApp` a propriedade de `activeTab` e composição principal.
3. **Perfil/Comunidades**: converter injeções/observers em composição React e props/contextos explícitos.
4. **Loja/ERP**: separar bootstrap da loja do `LegacyApp` e mapear Retailer/Storefront/Produtos/PDV por autoridade.
5. **IA/Kyrubia**: substituir runtimes explicitamente Legacy após identificar consumidores.
6. **Legados operacionais restantes**: carrinho, configuração, mesa/atendimento, promoções.
7. **Revisão das bridges legítimas**: manter integrações externas/observabilidade onde a fronteira for correta.

## Gate antes de cada remoção

Para cada legado: listar consumidores -> identificar estado/regra que possui -> criar equivalente canônico -> migrar consumidores -> provar testes/fluxo -> só então remover legado/bridge. Nunca apagar primeiro e reconstruir depois.

## Decisão sobre a PR #906

A #906 não deve ser mergeada enquanto depender de remendo novo no `LegacyApp`. Os commits que adicionam navegação canônica apenas no nome, mas fazem `LegacyApp` continuar como receptor autoritativo, não representam o destino arquitetural.


## Inventário de autoridade do LegacyApp

A leitura do `LegacyApp` em `main` encontrou **92 estados locais via useState**. Isso confirma que ele não é apenas uma casca visual antiga: continua funcionando como agregador de estado de vários domínios.

### Estados por domínio

**Shell/autenticação/navegação**
- `isLoggedIn`, `authenticatedUserId`, `showLoginModal`, `gpsGranted`, `showGpsOverlay`
- `activeTab`, `activeSubTab`, `currentPath`
- `isGestaoOpen`, `gestaoRole`

**Loja/ERP**
- `tenants`, `stores`, `userStore`, `products`, `orders`
- configuração de loja, publicação, espaços de atendimento/produção
- `newProductModal` e campos de criação de produto

**Marketplace/checkout**
- `visitingStore`, `cart`, `isCartOpen`, dados do comprador

**Social**
- `posts`, `newPostText`, `radiusKm`, `searchQuery`
- `socialSubTab`, `ofertasFilter`, `pracaFilter`, `conectadosSubTab`
- chat, momentos e publicação de momento na Praça
- `useSocialDirectoryV2` também entrega conexões, solicitações e favoritos diretamente ao LegacyApp

**Renda/operação**
- `deliveries`, `freelanceJobs` e modais relacionados

**Conta/identidade**
- nome, email, foto, tipos de conta, endereço, WhatsApp
- biometria, PIN e vários campos KYC

**Carteira**
- `useWallet` injeta saldo, histórico e mutações diretamente no LegacyApp.

Conclusão: a retirada do LegacyApp deve ser uma **extração de autoridades por domínio**, não uma reescrita única do arquivo.

## Cadeias de legado confirmadas além do Social

A auditoria dos wrappers atuais encontrou:

- `RetailerPanel.tsx -> LegacyRetailerPanel.tsx`
- `StorefrontPanel.tsx -> LegacyStorefrontPanel.tsx`
- `StoreConfigModal.tsx -> LegacyStoreConfigModal.tsx`
- `KyrubTab.tsx -> LegacyKyrubTab.tsx`

Esses quatro casos têm o mesmo padrão estrutural: o arquivo de nome atual acrescenta comportamento à implementação Legacy em vez de ser uma implementação independente.

Há também componentes atuais que **não importam Legacy diretamente**, como `NewProductModal.tsx`, `PerfilTab.tsx` e `RendaTab.tsx`. Porém isso não os torna automaticamente independentes: eles ainda recebem grande parte do estado e callbacks do LegacyApp. Portanto a classificação deve considerar propriedade de estado, não apenas imports.

## Matriz de autoridade — segunda passagem

| Área | Dono atual observado | Dependência | Destino |
| --- | --- | --- | --- |
| Navegação principal | `LegacyApp.activeTab` | bottom nav + bridges externas | mover para shell canônico fora do LegacyApp |
| Marketplace/Praça | `LegacyApp.socialSubTab` + filtros | `KyrubTab -> LegacyKyrubTab` | estado e tela canônicos em componente social atual |
| Pessoal | `ProfileSocialHubNative` já possui estado próprio | abertura ainda coordenada por bridge global | integrar ao shell canônico |
| Comunidades | dados cloud próprios | montagem por DOM/MutationObserver no perfil | composição React explícita |
| Loja privada | `LegacyApp.userStore` + bootstrap | `StorePersistenceBridge` espera o LegacyApp criar/ler primeiro | criar store provider/bootstrap canônico |
| Produtos/pedidos | arrays no LegacyApp + serviços novos ao redor | Retailer wrapper/bridges | mover para stores/hooks canônicos por domínio |
| Retailer/ERP | wrapper atual sobre `LegacyRetailerPanel` | grande risco de dupla implementação | decompor por workspace antes de remover |
| Storefront | wrapper atual sobre `LegacyStorefrontPanel` | serviços atuais alimentam apresentação antiga | tornar Storefront atual independente |
| Configuração de loja | wrapper atual sobre `LegacyStoreConfigModal` | persistência atual + UI antiga | migrar UI base mantendo contratos atuais |
| Notas | `PerfilTab` atual, estado fornecido pelo LegacyApp | autoridade ainda no pai antigo | extrair provider/hook de produtividade |
| Renda | `RendaTab` atual, estado fornecido pelo LegacyApp | autoridade ainda no pai antigo | extrair estado operacional |
| Identidade/KYC | muitos estados no LegacyApp | modais/bridges de perfil | mapear antes de mover; alta sensibilidade |
| Carteira | hook dedicado já existe | hook é instanciado pelo LegacyApp | candidato mais simples a sair do shell antigo |

## Estratégia de desmontagem do LegacyApp

O LegacyApp deve virar progressivamente um consumidor fino e depois desaparecer:

`LegacyApp monolítico`
→ extrair providers/controladores canônicos por domínio
→ componentes atuais passam a consumir esses controladores diretamente
→ wrappers deixam de depender de componentes Legacy
→ LegacyApp perde estados e handlers
→ shell atual assume composição
→ remover LegacyApp quando não possuir autoridade.

A primeira extração continua sendo **Social**, mas agora ela será feita como modelo para as demais: criar autoridade social atual, migrar Marketplace/Praça/Pessoal/Comunidades para ela e retirar `LegacyKyrubTab` da cadeia. Não adicionar novos eventos cujo receptor autoritativo seja LegacyApp.


## Auditoria de bridges globais e manipulação de DOM

Terceira passagem: bridges montadas globalmente em `main.tsx`/`App.tsx` e bridges operacionais de alto impacto foram inspecionadas por sinais de acoplamento à estrutura visual: `MutationObserver`, `querySelector`, `createElement`, portals, listeners globais, timers e cliques programáticos.

### Grupo vermelho — compatibilidade interna de alto risco

**HeaderDiscoveryShortcutActivationBridge**
- consulta repetidamente estrutura do header/social hub;
- intercepta clique global em capture;
- executa vários `.click()` programáticos para abrir/fechar/trocar destinos.
- Classificação: **TRANSIÇÃO / retirar** quando a navegação canônica existir.

**WorkspacePrimaryNavigationBridge**
- descobre a bottom nav pelo DOM;
- cria hosts manualmente, usa portals e MutationObserver;
- intercepta cliques globais;
- executa cliques programáticos para perfil/notas/Kyrub e para destinos internos.
- Classificação: **TRANSIÇÃO CRÍTICA**. Hoje funciona como segundo sistema de navegação sobre o LegacyApp.

**ProfileNextPolishBridge**
- localiza botões/seções por texto/estrutura;
- cria vários hosts manualmente;
- usa timer de sincronização a cada 250 ms;
- portals disparam cliques em controles originais.
- Classificação: **TRANSIÇÃO / absorver no ProfileSocialHubNative**.

**ProfileOffersFiltersBridge**
- localiza heading/cards por DOM;
- injeta botões/host;
- timer de 300 ms + listener global de clique.
- Classificação: **TRANSIÇÃO / absorver no componente de Marketplace/ofertas**.

**ProfilePublishingDestinationsCloudBridge**
- descobre composer/labels/textarea pelo DOM;
- cria host, MutationObserver e listener global;
- apesar de usar dados cloud, sua integração visual é implícita.
- Classificação: **TRANSIÇÃO**; preservar serviços cloud, substituir montagem.

**ProfilePostInteractionsBridge / ProfileRecoveredActionsBridge**
- grande número de seletores, hosts criados, portals e timers de 250–300 ms;
- enriquecem cards/forms existentes sem composição React explícita.
- Classificação: **TRANSIÇÃO ALTA**; lógica útil deve ser migrada para componentes canônicos.

### Grupo laranja — operacional com risco semelhante

**OperationalAppEntryBridge**
- encontra botões da navegação pelo DOM e executa cliques;
- MutationObserver aguarda a UI aparecer.
- Classificação: **TRANSIÇÃO**; entrada operacional deve usar roteamento/estado explícito.

**PickupPdvNavigationBridge**
- injeta hosts em tabs/KDS, instala listeners diretamente e executa cliques programáticos;
- usa MutationObservers para manter alterações.
- Classificação: **TRANSIÇÃO ALTA**; não remover até migrar a fila/PDV para componentes canônicos.

**ProductWorkspaceLayoutBridge**
- usa MutationObserver/DOM/portal para complementar workspace de produto.
- Classificação preliminar: **TRANSIÇÃO**, requer leitura funcional antes da retirada.

### Grupo amarelo — apresentação transversal

**AppModalLayoutBridge**
- observa o DOM global para decorar/reorganizar overlays/modais e reage a viewport.
- Não parece possuir regra de negócio, mas acopla layout à estrutura DOM de vários modais.
- Classificação: **TRANSIÇÃO DE APRESENTAÇÃO**; pode ser retirada depois que modais compartilharem um shell/layout canônico.

**KyrubiaNamingBridge**
- usa MutationObserver, seletores e timer para normalizar nomenclatura.
- Classificação: **TRANSIÇÃO DE APRESENTAÇÃO**; nomes devem ser corrigidos nas fontes/componentes, não pós-processados no DOM.

### Grupo verde provisório — fronteiras explícitas

Bridges que tratam OAuth, provedores externos, sincronização cloud, observabilidade ou eventos entre subsistemas não entram automaticamente na fila de remoção. Exemplos: retornos OAuth do Mercado Livre/Mercado Pago, recebíveis, tracking e observabilidade. Elas serão auditadas por contrato, mas não há justificativa para removê-las apenas por serem chamadas Bridge.

## Diagnóstico consolidado

O problema estrutural não é apenas “há código antigo”. Existem **dois modelos de composição concorrentes**:

1. React/estado/serviços atuais;
2. uma camada de compatibilidade que trata o DOM renderizado pelo sistema antigo como se fosse uma API: procura elementos, cria hosts, injeta portals, observa mutações e simula cliques.

Esse segundo modelo explica intermitências: mudanças de texto, ordem de montagem ou estrutura visual podem quebrar comportamento sem erro de tipo ou compilação.

## Regra nova para código futuro

A partir deste mapa, novas funcionalidades internas não devem:
- procurar controles de outra tela por texto/placeholder para acioná-los;
- usar `.click()` programático como navegação;
- usar `MutationObserver` para descobrir quando uma tela interna ficou pronta;
- criar hosts DOM manualmente para completar um componente interno que podemos editar;
- usar timer periódico para manter patches visuais internos.

Exceções precisam ser fronteiras técnicas justificadas (por exemplo integração com DOM de terceiro) e documentadas.

## Fila de modernização derivada do risco

**Onda 1 — Social e navegação:** WorkspacePrimaryNavigationBridge, HeaderDiscoveryShortcutActivationBridge, LegacyKyrubTab e bridges Profile que patcham Social/Pessoal.

**Onda 2 — Shell:** extrair `activeTab`/composição do LegacyApp e substituir bridges de entrada/nomenclatura/layout.

**Onda 3 — ERP operacional:** RetailerPanel/LegacyRetailerPanel, ProductWorkspaceLayoutBridge, PickupPdvNavigationBridge e OperationalAppEntryBridge.

**Onda 4 — Storefront/configuração:** LegacyStorefrontPanel e LegacyStoreConfigModal.

Essa ordem é por acoplamento estrutural, não por importância de negócio.


## Serviços e componentes atuais reaproveitáveis

Quarta passagem: foram separados contratos de dados/componentes atuais da camada de compatibilidade DOM. O resultado é favorável: a modernização não exige reconstruir o Social do zero.

### Social — preservar

**usePublicSocialFeed**
- hook React/Firebase sem dependência de DOM legado;
- já concentra feed público e interações relacionadas.
- Classificação: **CANÔNICO / candidato a compor SocialDomainProvider**.

**useSocialDirectoryV2**
- hook React/Firestore sem manipulação de DOM;
- concentra usuários, conexões, solicitações e favoritos.
- Classificação: **CANÔNICO**, embora hoje seja instanciado também pelo LegacyApp.

**PublicSocialFeedPanel**
- componente sem querySelector/MutationObserver/click programático/portal.
- Classificação: **CANÔNICO REUTILIZÁVEL**.

**ConnectedContactsPanel**
- componente sem manipulação de DOM.
- Classificação: **CANÔNICO REUTILIZÁVEL**.

**ProfileSocialHubNative**
- já é uma implementação React própria e não depende de seletores/MutationObserver;
- usa hooks sociais atuais.
- Ainda possui portals legítimos de modal e um click programático pontual a revisar, mas não apresenta o padrão de patch global.
- Classificação: **BASE CANÔNICA DO PESSOAL**.

### Comunidades — preservar dados, substituir composição

**useCommunityDirectory**
- hook independente do DOM.
- **CANÔNICO**.

**communityCloud.ts**
- contratos Firestore/Storage explícitos para comunidades, membros, posts, debates, comentários, capa e moderação;
- nenhuma dependência de DOM.
- **CANÔNICO**.

**ProfileCommunitiesCloudBridge**
- regra/dados atuais, mas montagem visual por DOM, MutationObserver, timer e portals.
- **DIVIDIR**: preservar lógica/componentes de comunidade; retirar o mecanismo de descoberta/injeção no modal.

### Marketplace — preservar contratos, substituir shell legado

**marketplaceDiscovery.ts**
- serviço sem dependência visual.
- **CANÔNICO**.

**marketplacePaths.ts**
- caminhos/identidade de documentos.
- **CANÔNICO**.

**publicProducts.ts**
- criação, parsing, persistência e subscriptions de produtos públicos; sem DOM.
- **CANÔNICO**.

O `KyrubTab.tsx` atual já usa descoberta/listings canônicos e não manipula DOM. O problema é que seu tipo e sua renderização ainda envolvem `LegacyKyrubTab`. Portanto ele é um bom ponto de migração: **manter seus reads/componentes atuais e substituir a base Legacy**.

### Pedidos/ERP — contratos já aproveitáveis

**customerOrders.ts**
- contrato amplo e explícito para pedido, status, pagamento, persistência, subscriptions e transições.
- sem dependência visual.
- **CANÔNICO**.

**canonicalOrderNavigation.ts**
- contrato explícito para intenção/ack/consumo de navegação de pedidos.
- não depende de DOM.
- **CANÔNICO**, embora o uso de eventos deva permanecer restrito a contrato de domínio, não simulação de UI.

**storePersistence.ts / storePaths.ts**
- persistência e identidade da loja estão separadas da UI.
- **CANÔNICOS**.
- O problema atual é o bootstrap/orquestração ainda depender do LegacyApp, não esses utilitários.

## Consequência para a Onda 1

Não precisamos criar um “novo Social” do zero. A migração deve recompor peças que já existem:

```
SocialWorkspace (novo dono de navegação social)
├── Pessoal -> ProfileSocialHubNative
├── Praça -> PublicSocialFeedPanel + usePublicSocialFeed
├── Marketplace -> descoberta/listings atuais
├── Conectados -> ConnectedContactsPanel + useSocialDirectoryV2
└── Comunidades -> UI extraída do ProfileCommunitiesCloudBridge
```

O `SocialWorkspace` não deve importar `LegacyKyrubTab`, procurar bottom nav/header no DOM ou receber `socialSubTab` do LegacyApp.

### Estado mínimo que deve sair primeiro do LegacyApp

- `socialSubTab`
- `ofertasFilter`
- `pracaFilter`
- `conectadosSubTab`
- coordenação de abertura entre Pessoal/Praça/Marketplace/Conectados/Comunidades.

Posts/conexões podem inicialmente continuar vindo dos hooks atuais sem migração de schema. Isso reduz drasticamente o risco.

## Primeiro desenho de contrato canônico de navegação social

Destino deve ser dado sem referência a botão ou texto visual:

`pessoal | praca | marketplace | conectados | comunidades`

A API interna pode ser Context/Reducer do React no shell autenticado. O componente que solicita navegação informa o destino; o workspace renderiza o destino. Não há clique indireto nem busca por DOM.

A URL pública/canônica da página Pessoal é um problema separado e não precisa bloquear a retirada do LegacyKyrubTab.

## Situação do mapeamento antes da implementação

Já temos evidência suficiente para iniciar a Onda 1 sem reconstrução cega:
- autoridade antiga identificada;
- bridges de compatibilidade identificadas;
- serviços/hooks que sobrevivem identificados;
- componentes React reutilizáveis identificados;
- estado mínimo a extrair delimitado.

Ainda será necessário validar os contratos/props exatos de `LegacyKyrubTab` durante a implementação para garantir paridade funcional antes de removê-lo.
