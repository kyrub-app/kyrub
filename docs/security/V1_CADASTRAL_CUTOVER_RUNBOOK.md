# V1 — Candidato de corte cadastral (não autorizado para implantação)

## Evidência e escopo
Base auditada: `c6bb73b9bb22ac72dcf68ae0731844a8024d271a` (#1342). Inventário CI 45829335723: 1.198 arquivos, 135 candidatos, 35 no cliente. Seis testes de privacidade integrados aprovados. #1332 reconciliada, #1340/#1341 com CI e Vercel verdes. Candidato reproduzível por `npm run firestore:compose` e `node --import tsx scripts/build-cadastral-privacy-candidate.ts`. A saída tem extensão .rules.txt em .firebase/privacy-review-only, manifesto SHA-256 e não substitui regras compostas/configuração. A CI compara exatamente o artefato ao texto entregue ao emulador. Não executar deploy com esse artefato.

## Revisão dos acessos do cliente
| Categoria | Caminhos | Tratamento |
| --- | --- | --- |
| Descoberta, autores, comunidade | socialDiscoveryDirectory, useLiveAuthorIdentities, communityPostConnections, UserSearchModal | Transporte social protegido quando ativado; legado ainda presente |
| Equipe | storeDirectory, StoreTeamWorkspace | Busca e convite autenticados com flags independentes; proibir helpers diretos quando piloto/protegido ativo |
| Administração | adminDirectory, adminControlPlane | Consulta auditada e agregação protegidas; legado ainda presente |
| Titular | App, LegacyApp, ProfileIdentityRecoveryBridge, ProfilePublicIdentityEditor, UserProfileModal, ProfileSocialHubNative/Bridge, ProfileRecoveredActionsBridge, OfficialKyrubTagPanel | Manter raiz própria e edição da apresentação |
| Subcoleções | StoreConfigModal, erpReadActionService, useProductivityNotes, savedLibrary, ProfileCommunitiesCloudBridge, grupos, favoritos | Preservar regras específicas de titular/escopo |
| Notas compartilhadas | SharedNotesModal, SharedNoteParticipantEditor, NoteInvitationOutboxBridge | Acesso por convite/participação; validar aceite, alteração de checklist e revogação no navegador |
| Legados e indiretos | useSocialDirectory, useNotes, storePaths, productInventory, kyrubiaConversationCloudSync | Verificar aliases, montagem e autorização; Kyrubia fora deste ciclo |

Inventário estático não prova alcance em runtime nem ausência de aliases. Não afirmar que todos os acessos estão migrados; há caminhos de compatibilidade e caches/históricos que não devem ser apagados automaticamente.

## Condições obrigatórias antes do corte
1. Consolidar a cadeia sobre a revisão produtiva exata, com diff verificável e CI integral; sem merge/deploy sem autorização.
2. Homologar navegador isolado: dois usuários, troca de sessão, descoberta/paginação, ocultar perfil, autor histórico, conexões, notas, equipe, aceite/recusa e Control Plane. Confirmar NFC não afetado.
3. Verificar regras atualmente implantadas e autorização real de Firebase Auth/Firestore, sem copiar registros reais para emulador. Aferição confiável de maioridade, política de ingresso e MFA TOTP real (incluindo recuperação) não demonstrados. Declaração de idade não é evidência confiável.
4. Rever transições de membros existentes: aceite, reativação, promoção, suspensão; o teste atual comprova criação negada e aceite preservado, não autoriza contornar age/MFA por updates legados. Validar também proteção de criação de conexões, perfis e notas.
5. Validar disponibilidade e coerência das flags cliente/servidor (social/admin/staff) antes de qualquer corte, incluindo erro sem fallback. Nenhum fornecedor ou contratação autorizada. Revisão humana jurídica e Pix real permanecem independentes.
6. Preparar sequência autorizada e reversão: código compatível e transporte validado primeiro; habilitação coordenada só com pré-requisitos; então regras restritas após verificar clientes ativos. Não restaurar leitura ampla como rollback automático; em falha preservar dados e interromper somente superfície afetada. Não declarar lançamento comercial pronto enquanto houver bloqueadores.

A regra candidata não está implantada e a ativação das flags, alteração de regras produtivas, contratação e deployment requerem autorização específica.
