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
