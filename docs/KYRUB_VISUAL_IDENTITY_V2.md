# Kyrub — Identidade visual V2: Pitanga e verde-noite

## Objetivo e origem

Adotar a identidade aprovada: **selo geométrico da pitanga visto de cima**, em laranja,
com **talo e duas folhas verde-sálvia no centro**. A marca passa a ser construída
em vetor, não mais uma imagem JPEG encapsulada no SVG. Preservamos a navegação,
o modo escuro e a estrutura dos dados e dos fluxos do aplicativo.

O novo conjunto está em `public/kyrub-logo.svg` (favicon, PWA, navegação e
páginas de entrada). O gesto **Semear** usa um ícone complementar próprio:
`public/kyrub-pitanga-seed.svg`, sem emoji de feijão e sem confundir semente
com o fruto.

## Paleta canônica

| Papel | Token | Cor |
|---|---|---|
| Fundo de tela / noite | `--kyrub-night` | `#121A17` |
| Superfície / cards | `--kyrub-moss` | `#1C2622` |
| Elevação / seções | `--kyrub-moss-raised` | `#26332E` |
| Apoio, legenda, borda | `--kyrub-sage` | `#8FA893` |
| Logo, ações primárias | `--kyrub-orange` | `#F27429` |
| Títulos e alto contraste | `--kyrub-cream` | `#F5F0E6` |
| Cartões editoriais claros | `--kyrub-sand` | `#EAE3D5` |

As bordas dos cartões escuros usam `rgba(143, 168, 147, 0.2)`.
Os tons `slate`, `orange` e `teal` do Tailwind são remapeados via
`@theme` em `src/index.css`, para levar o tema às centenas de classes
existentes sem reescrever cada painel e sem ampliar a lógica de negócio.
Cores de erro/sucesso ou indicadores técnicos não precisam ser reduzidas
à paleta da marca.

## Quatro tratamentos tonais

1. **Hero / manifesto:** base noturna `#121A17`, superfícies musgo, texto creme,
   assinatura laranja. Classe `kyrub-brand-hero`.
2. **Metodologia / pilares:** camadas de `#1C2622` e `#26332E`,
   texto creme e detalhes sálvia. Classes `kyrub-tone-raised` e `kyrub-tone-organic`.
3. **Respiro editorial:** um bloco de creme `#F5F0E6` e cartões areia
   `#EAE3D5` dentro de uma página escura, sempre com texto **escuro**
   `#121A17`/`#2C3833`. Classes `kyrub-tone-editorial`,
   `kyrub-editorial-card` e `kyrub-editorial-body`.
4. **Destaque / chamada final:** musgo intermediário, noite profunda e
   **laranja reservado aos botões primários**. Classe `kyrub-tone-organic`.

Não aplicar superfícies claras indiscriminadamente a formulários financeiros,
tabelas operacionais ou modais com estados coloridos; o contraste claro é
**pontual e editorial**.

## Distribuição em painéis

| Painel / superfície | Aplicação |
|---|---|
| Entrada Renda (nativa e `LandingView`) | Logo, wordmark serif, hero noturno, cartões elevados, bloco editorial creme, CTA laranja |
| App autenticado (Jemboé, Catu, Taba) | Assinatura discreta do logo e nome no começo do workspace; fundo noturno por padrão |
| Jemboé — Habilidades | Cartão editorial claro com texto verde-noite e botão primário laranja |
| Catu — Renda e entregas | Cartões escuros com elevação alternada, destaques laranja/sálvia |
| Taba — Praça / Comunidades / Lojas | Cartões musgo, bordas sálvia e ações principais em laranja |
| Pitangas e XP | Painel orgânico musgo, carteira e ledger permanecem sem mudança |
| Meu perfil / conexões | Mesmas bases noturnas e superfícies musgo; dados e chat intocados |
| ERP, administração e demais rotas | Tokens globais de tema em fundo, cards, bordas e tipografia; sem alterar fluxo operacional |
| PWA / navegador | Ícone vetorial único; `theme_color` e `background_color` em `#121A17` |

O nome Kyrub usa serif editorial quando aparece como assinatura visual,
enquanto textos densos, botões, indicadores e tabelas continuam com tipografia
de interface para preservar legibilidade.

## Proteção e verificação

- O tema não pode modificar IDs, autorizações, rotas, planos, preços, Pix,
  Pitangas, XP, pedidos, transações ou regras do Firestore.
- Verificações em `tests/landing-brand-refresh.test.ts`,
  `tests/kyrub-identity-v2.test.ts` e
  `tests/square-post-connections.test.ts` estão incluídas no prebuild.
- Validar visualmente no celular as telas com superfícies claras, a leitura
  de textos menores, o contraste dos CTAs e a navegação do ERP.
- A arte vetorial utiliza apenas caminhos SVG estáticos, sem fontes externas,
  imagens raster ou scripts.

## Rollback

Reverter o PR restaura a paleta e os assets anteriores; nenhum dado do usuário
é migrado ou alterado por esta entrega.
