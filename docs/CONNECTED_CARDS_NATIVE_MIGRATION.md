# Plano de migração — Cards dos conectados

Estado inicial: homologação após PR #975. Não remover o bridge antes de substituir todos os comportamentos.

## Ownership atual e acoplamentos confirmados

- `ProfileSocialHubNative.tsx` renderiza `ContactCard` em **Conectados** e **Favoritos**, e já possui os callbacks `onFavorite`, `onChat`, `onRemove` e `latestStatus`.
- `ProfileConnectedCardsPolishBridge.tsx` possui **902 linhas** e executa polling de 250 ms sobre o DOM do modal. Identifica o card pela presença de botão de remoção, reescreve atributos, labels, imagens e injeta estilos.
- O bridge consulta `users` e `users/{uid}/contact_groups` por Firestore e também usa `usePublicSocialFeed`; o Native já possui dados próprios de contatos, grupos e status. Evitar listeners duplicados ao migrar.
- A associação do card ao usuário no bridge usa **nome normalizado** como fallback para encontrar `friendId`; o contrato novo deve passar `friend.id` diretamente, sem ambiguidade entre nomes iguais.
- O bridge captura cliques no documento em fase de captura, intercepta mídia, título e menu e reexecuta `button.click()` para remoção. Isso não pode ser removido sem migrar os modais e ações.
- A PR #975 concentrou o ajuste de imagem no bridge dos cards, mas **não** eliminou esse bridge. O efeito visual precisa migrar junto do card.

## Sequência segura

1. Extrair a apresentação do card para um componente React com props tipadas: `friend`, `latestStatus`, `groupNames`, `onFavorite`, `onChat`, `onRemove`, `onOpenProfile`, `onOpenStatus`, `onOpenMenu`.
2. Preservar proporção da imagem (`contain`), fundo desfocado, gradiente, status, nome, grupos e ações.
3. Migrar o menu e seus modais: perfil, status, inclusão em grupos, confirmação de remoção, denúncia e mensagens de erro.
4. Reutilizar os dados já existentes no Native; verificar a necessidade de dados extras antes de remover assinaturas Firestore do bridge.
5. Substituir os dois usos de `ContactCard` (Conectados e Favoritos), com testes de eventos e identidade por UID.
6. Somente então desmontar `ProfileConnectedCardsPolishBridge` de `main.tsx` e retirar polling/captura global de clique.

## Gates

- Contatos homônimos e fotos/status diferentes não podem se misturar.
- Favoritar, chat, abrir perfil, abrir status, gerenciar grupos, denunciar e remover devem manter seus comportamentos.
- Imagem ausente e imagem em retrato/paisagem; mobile e desktop.
- Confirmar regras de segurança e isolamento por UID antes de mexer em consultas.
- TypeScript, testes de contratos, build, preview READY e validação visual antes de merge.

Esta etapa documenta dependências e não altera runtime, Firestore nem produção.
