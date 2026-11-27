# Kyrub — Reconciliação comercial da V1 e privacidade
Data: 27/11/2026. Documento interno de decisão e evidências, sem implantação ou aprovação jurídica. Não altera código, flags, regras, dados, contratos, documentos públicos ou cobrança.

## Evidência verificável
- Branch de produção: release/kyrub-tag-permanent-stock; commit acebfca248d97cb2f28445280444171eee60f074 (merge #1350). Último deployment de produção listado na Vercel: dpl_rLB8Df2a81c6AvSvkp1RQLJm88BD, READY, mesmo SHA, projeto kyrub. READY não comprova operação funcional ou configurações de todos os domínios.
- Candidato de homologação: #1406, d35bc447458e5788090e382cf25630090374105f. Chromium 45956593409 e Application build 45956593415 concluídos com sucesso; status Vercel success. #1405: matriz integrada 45952166645, build 45952166720 e Store security rules 45952166646, sucesso. #1404 corrigida: Chromium 45952047189, sucesso. Não extrapolar os testes sintéticos para dados reais, autenticação administrativa produtiva, contratos ou atendimento efetivo.
- Comparação produção...#1406: ahead 310, behind 0, merge base acebfca248d97cb2f28445280444171eee60f074, 179 arquivos (52 testes, 44 workflows, 27 server, 25 src, 20 shared, 9 docs, 2 dependências). 168 adicionados e 11 modificados. Não promover a cadeia inteira.
- #1342 (c6bb73b9bb22ac72dcf68ae0731844a8024d271a) é ancestral da revisão produtiva: comparação produção...#1342 behind 46, ahead 0, merge base igual ao head #1342. PR consta aberta, mas isso não prova ausência do código. Corte de regras/flags continua não comprovado; não reaplicar automaticamente #1342 nem retargetar sua PR.
- #1385 permanece rascunho sem homologação específica; não integra o candidato, não promover nem tentar completar a frente de autorização de evidências neste ciclo.
- O handoff original ONBOARDING_SECURITY_V1_WORK_HANDOFF.md está ausente da árvore produtiva consultada, mas foi recuperado do commit 9a5e3c421e5ae7a36b9f78918b7f343e0e94f975 e confirmado idêntico no HEAD da #1316 (blob 5d902bcc69e718fc4b68313973febdf2db05daf0). A #1408 restaura exatamente esse arquivo em PR isolada sobre acebfca, commit bac8c58c7166e7759c23bbc102b8ffbfe402c0bc, sem código; aguarda aprovação e merge. Recuperação documental comprovada; revisão jurídica e evidências operacionais continuam pendentes. Não inferir publicação ou vigência.

## Fracionamento
A. Documentação interna: este PR parte diretamente de acebfca e contém somente este documento. As minutas e matriz em docs/legal da #1406 permanecem na cadeia candidata; trazer documentos específicos após revisão de referências, sem copiar código ou substituir publicações vigentes.
B. CID/Pix/SOS: manter candidato separado da V1 principal. Compartilhamento e visão autenticada existentes preservados. Pix estático #1351–1352, SOS/chat/localização e demais pilotos #1353–1384 não são autorizados para produção por CI; #1362 é agregador de homologação, não release. Diffs produtivos em kyrubTagPasskeyLifecycle.ts, kyrubTagPasskeyState.ts, kyrubTagService.ts, kyrubTagPromotional.ts, KyrubTagPasskeyActions.tsx, PublicKyrubTagPage.tsx e dependências exigem revisão individual.
C. Privacidade: #1386–1406 como referência preservada. Nenhum adapter de emulador ou tela de teste montado em produção; não disponibilizar aviso simulado como canal oficial. Priorizar canal operacional seguro com atendimento humano, inventário e publicação versionada; posteriormente integrar as automações aprovadas. Revisar exportação real por finalidade e direito, sem aproveitar coleções fictícias ou usar dados de terceiros.
D. Segurança cadastral: reusar candidato e evidências de docs/security/V1_CADASTRAL_CUTOVER_RUNBOOK.md; confirmar versão efetivamente implantada das regras, flags, MFA e maioridade antes de corte. Não reabrir auditoria comprovada sem evidência de regressão.
E. ERP/comercial: manter trilha independente. Preservar planos Free/Pro/Business, NFC, catálogo, pedidos e gamificação. Conciliar a evidência atual de criação de loja, pedido, estoque e conciliação; não reexecutar etapas comprovadas nem ativar cobrança real sem aprovação. Gate 1:N segue fechado segundo docs/GATE_MERCADO_PAGO_1N_2026-08-30.md; não confundir pré-validação de recebedor com habilitação de cobrança ou repasse. Kyrubia fora da V1 comercial.

## P0 — lista objetiva para fechamento
| Portão | Evidência mínima | Situação deste levantamento |
|---|---|---|
| Escopo e revisão de release | SHA real, diff pequeno, CI exato, rollback, autorização individual | Produção e candidato identificados; promoção não autorizada |
| Controlador/documentos/canal | Identidade e responsável confirmados; versões públicas aprovadas; canal funcional sem conta | Não comprovados |
| Atendimento de direitos | Procedimento humano seguro com responsável, prazos, prova proporcional, resposta e encerramento; testes de isolamento | Pilotos técnicos aprovados, operação real não comprovada |
| Inventário e fornecedores | Operações ativas, bases, retenção, contratos, transferências, responsáveis | Minutas candidatas, revisão pendente |
| Segurança e ingresso | Maioridade confiável, MFA administrativo/financeiro, autorização real e corte cadastral coordenado | Reusar evidência anterior; estado efetivo não comprovado |
| Incidentes e recuperação | Contatos reais, exercício de mesa, calendário, backup/restauração | Procedimentos preliminares, exercício operacional pendente |
| ERP comercial | Evidência integrada criação de loja → pedido ERP → estoque → conciliação; preservar regras de planos | Recuperar relatório anterior e identificar apenas lacuna efetiva |
| Pagamentos | Evidência e autorização específica para Pix real; 1:N independente | Não comprovados neste levantamento; sem ativação |

Referências: docs/PRIVACY_SECURITY_READINESS.md, docs/RELEASE_CHECKLIST.md, docs/security/V1_CADASTRAL_CUTOVER_RUNBOOK.md, docs/KYRUB_TAG_COMMERCIAL_DIRECTION_2026-11-26.md, docs/OFFICIAL_PLAN_PIX_RELEASE.md, docs/GATE_MERCADO_PAGO_1N_2026-08-30.md, docs/LAUNCH_QUEUE_2026_11_15.md e docs/legal/KYRUB_PRIVACY_V1_RELEASE_MATRIX.md no head #1406. Documentos antigos são checkpoints históricos, não provas atuais.

## Ordem de execução recomendada
1. Recuperar relatório de fechamento comercial existente e comparar seu SHA com produção; identificar somente bloqueadores remanescentes, sem reexecutar pilotos de privacidade.
2. Reconciliar jurídico e canal manual seguro com responsáveis reais, sem publicar minutas ou criar endereço de contato fictício.
3. Separar PRs funcionais por dependência e evidência; exigir testes exatos e autorização antes de cada merge/deployment. Revisar dependências, não usar número de commits como medida de tamanho funcional.
4. Validar operação comercial E2E, corte cadastral e procedimentos de incidente/restauração estritamente no escopo aprovado; recursos não prontos permanecem desativados.
5. Registrar decisão humana de liberação e resultado pós-release. Não declarar conformidade LGPD integral nem V1 comercial liberada com base nesta auditoria documental.
