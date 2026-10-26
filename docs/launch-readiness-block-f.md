# Kyrub 1.0 — Bloco F: entrada pública e ativação contextual

Status: auditoria inicial de código; implementação pendente. Preservar a lista-mãe e o mapa de auditoria transversal. Não remover legados como pré-requisito do lançamento.

## Contrato de produto
- Visitante não autenticado abre Renda Aberta, navega oportunidades públicas, Marketplace, Praça e comunidades públicas.
- Operações de gravação, publicação, contratação e gestão exigem Google e retomada da intenção original.
- Aceitar trabalho remunerado exige aprovação documental por categoria, validada no servidor.
- Cairúbia pública: somente capacidades seguras, com cota e proteção contra abuso; nunca presumir API gratuita ilimitada.
- Loja: Salvar rascunho separado de Publicar no Marketplace; preservar primeira data publicada.
- Nunca mostrar dados privados ou oportunidades fictícias como reais.

## Evidências da inspeção (homologação)
- src/LegacyApp.tsx:1395-1404 bloqueia toda a aplicação atrás de LandingView quando !isLoggedIn. Estado inicial activeTab='renda' na linha 267.
- src/LegacyApp.tsx:1492-1504 monta RendaTab com callbacks que abrem modais de entregas e freelances; esses callbacks ainda não têm um guard contextual de login.
- src/LegacyApp.tsx:409-416 e 487-494: estados de entregas/freelas com cache localStorage; verificar autoridade compartilhada entre usuários antes de anunciar oportunidades reais.
- src/components/tabs/RendaTab.tsx:201-260: botões Solicitar entrega, Fazer entregas, Solicitar freela, Fazer freela.
- src/LegacyApp.tsx:1588: ERP modal condicionado a isGestaoOpen; não permitir abrir gestão privada para visitante.
- src/utils/storePersistence.ts:331+: já existe setStoreMarketplacePublication; reutilizar, sem criar fluxo paralelo.
- src/LegacyApp.tsx:307: isStorePublished inicializado true; verificar a origem autoritativa antes de expor estado publicado.

## Gates de implementação
1. Separar shell público de recursos privados sem alterar rotas administrativas/staff.
2. Ler oportunidades públicas de fonte autoritativa; não exibir cache local como oportunidades globais.
3. Criar guard central de ação contextual (login + intenção pendente + retomada) com bloqueio no backend.
4. Garantir isolamento Firestore e nenhuma leitura privada anônima.
5. Introduzir fluxo rascunho/publicação com autorização do proprietário e validação de dados.
6. E2E com visitante, usuário, prestador não aprovado, prestador aprovado, lojista e outra loja.
7. Build, testes, homologação fixa e validação visual antes de produção.

## Auditoria transversal preservada
A migração/remoção de LegacyKyrubTab e demais camadas continua registrada como pós-lançamento, salvo se corrigir bloqueador comprovado. Priorizar fluxo completo ERP/KDS → Renda → entregador e Freelas reais.
