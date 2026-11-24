# Integração controlada — Conectados, Tribo Reservada e Kyrub Tag

Branch de trabalho independente. As PRs #1271, #1272 e #1273 não são alteradas por este rascunho. Nenhuma integração de aplicação está liberada. O manifesto fixa os commits e a ancestralidade; o workflow apenas calcula a árvore de merge local e reporta conflitos, sem checkout da árvore, sem publicar regras ou prévia e sem credenciais Firebase.

## Escopo
- #1272: fe281319346d8b22a7251d4e09b8034ac3015c3d; testes do último incremento ainda em andamento.
- #1273: efe2c7ba10428d2cc13f5b5c9270a57f43d9f80a; inclui a base #1271 6d6cf9e0bd36572bb81198e665cea784e4ad9ab5.
- Ancestral comum: 4134b44e0351555dd9e3583adf6f279202ee842b; 60 arquivos na frente social, 62 na frente Tag, 9 sobrepostos.

## Portões obrigatórios antes de qualquer merge
1. Resolver mecanicamente os conflitos, revisar semanticamente todos os arquivos compartilhados. Preservar isolamento Auth/Firestore/Storage e as flags do piloto; nenhuma ativação em Preview/Production por acidente.
2. presentationRelationship deve verificar ordinaryPresentationPeerAllowed dentro da transação, após resolver identidade e antes de expor estado/peer. Unificar mutação de conexão/bloqueio com revisão bilateral, sem duplicar API, sem revelar marcador da contraparte.
3. Não usar ChatModal/SDK direto, migração de bloqueios localStorage ou consulta de relacionamentos legados no piloto protegido. Reusar projeções autorizadas e chat efêmero; validar central de avisos.
4. Preservar regras do perfil público (occupation, coverUrl, backgroundUrl), tag_only, propriedade, SOS, proteção de bloqueios, composição Firestore e suíte Tag. Não apagar cache ou fila ERP. Validar usuário sem cofre, contraparte e visitante.
5. Rodar CI completo em emuladores. Testar popup Google, reabertura, revogação entre dispositivos, QR/clipboard, Tag acompanha perfil, importação independente e regressões ERP. Revisão de migração/cache legado é bloqueio de produção.
6. Storage real em kyrub-tags requer Blaze. Não vincular faturamento, não publicar regras ou alterar ambiente sem autorização explícita do titular. Testes locais podem prosseguir sem cobrança. Importação real continua pendente. Referência: https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024?hl=pt-BR .
7. Não mergear este rascunho nem deployar produção. O relato Work da #1273 é evidência fornecida pelo titular; a nova integração exige sua própria homologação.

## Decisão
O resultado verde da auditoria apenas comprova que a comparação foi executada; não significa ausência de conflito nem aprovação funcional.

## Primeira resolução — hooks de relacionamento
Auditoria 45465097573 confirmou nove arquivos compartilhados, cinco conflitos mecânicos: firestore.rules, package.json, ProfileSocialHubNative.tsx, useChatMessages.ts, useSocialDirectoryV2.ts. #1272 fe28131 aprovado 20/20; run 45464563158 confirma UI de bloqueios. Resolução semântica proposta de useChatMessages: a versão #1272 já contém o único acréscimo #1273 (setMessages([]) no erro) e preserva autorização de snapshots, corte privado e chat efêmero via ChatModal no piloto; arquivo mantido. useSocialDirectoryV2 passa a usar filtro de bloqueios #1273 apenas fora do piloto, exigindo snapshot confirmado para sugestão e conexão. Adapter useSocialBlocks trazido da #1273 com short-circuit de todas as operações locais/migração no piloto, API social-block e lista por projeção autorizada, sem fallback SDK. Fora do piloto preserva rota de apresentação e espera snapshot servidor. A rota de apresentação e regras de bloqueio da #1273 ainda não foram incorporadas a esta branch, portanto fluxo legado não está funcionalmente homologado. Testes estáticos adicionados. Os outros três conflitos e quatro arquivos compartilhados sem conflito continuam pendentes, assim como a árvore completa das Tags; não há merge efetivo ainda. Nenhuma mudança nas PRs originais ou faturamento.
