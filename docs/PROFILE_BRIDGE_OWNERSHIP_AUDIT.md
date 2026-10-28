# Auditoria de ownership — Perfil

Base de observação: homologação após PRs #972 e #973. **Documento de diagnóstico da homologação, não comprovação do runtime da main.** Escopo somente documental. A promoção deste documento não promove os componentes descritos.

## Montagem
- `src/main.tsx` monta `App`, `ProfileNextPolishBridge`, `ProfileConnectedCardsPolishBridge`, `ProfileConnectedImageFitBridge`, `ProfileContactGroupsPolishBridge`, `ProfileOffersFiltersBridge` e `WorkspacePrimaryNavigationBridge`.
- `src/App.tsx` monta `ProfileSocialHubNative` e `LegacyApp`.
- `src/LegacyApp.tsx` monta `AppHeader` e o workspace IA.

## Primeiro candidato: grupos de contatos
- Owner canônico proposto: `ProfileSocialHubNative`.
- Native já implementa `groups.map`, `toggleGroupMember`, `deleteGroup`, contagem e limite de membros.
- `ProfileContactGroupsPolishBridge` consulta DOM a cada 250 ms, cria slots, injeta botão via portal, esconde contatos e cria empty states.
- Migração necessária: estado `openGroupName`, botão adicionar/concluir, filtros de membros e estados vazios diretamente no JSX nativo. Remover Bridge apenas depois de testes e validação visual.

## Segundo candidato: imagens dos conectados
- `ProfileConnectedImageFitBridge` consulta `[data-profile-connected-media]` a cada 400 ms e grava `--profile-connected-image` com base no `img.src`, além de injetar CSS.
- Antes de migrar, localizar componente produtor desse atributo e manter `object-fit: contain`, fundo desfocado, fallback e responsividade.

## Gates
1. Grupos: criar, adicionar/remover membros, excluir, vazios, limites e mobile/desktop.
2. Imagens: ausente, carregando, erro, diferentes proporções e reabertura do modal.
3. Contratos de navegação/cabeçalho, testes TypeScript, build e homologação visual.
4. Não remover serviços de pagamentos, Firestore, estoque ou entregas por conterem `Bridge` no nome.

Nenhuma remoção ou deploy autorizado por este documento.
