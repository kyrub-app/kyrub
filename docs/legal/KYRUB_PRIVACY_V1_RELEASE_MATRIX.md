# Kyrub — Matriz consolidada de prontidão de privacidade V1
27/11/2026. Candidato documental, sem aprovação jurídica, merge ou deploy. Base 0ca186e6c4c4150fc6d8ba7f3650675c9c224cde (#1399 corrigida; CI da correção ainda não comprovada). Não é declaração de conformidade. Todas as implementações de direitos e consentimento abaixo são isoladas e sintéticas, não serviços ativos. Preservar versões vigentes e decisões anteriores. Não incluir #1385 (rascunho não homologado), não alterar Firebase de produção, não contratar, não ativar Kyrubia.

## Evidências e lacunas
| Frente | Referência na cadeia candidata | Evidência disponível | Pendência antes de uso real |
|---|---|---|---|
| Governança, CID e avaliação de impacto | #1386; KYRUB_PRIVACY_GOVERNANCE_V1.md; KYRUB_CID_LEGAL_DRAFT_V1.md; KYRUB_CID_ROPA_RIPD_DRAFT_V1.md | Minutas e checklist | Controlador, encarregado/responsável, contato, parecer humano, publicação/versionamento, ROPA/RIPD por fluxo efetivo |
| Recebimento | #1387–1388; privacyRightsPolicy/Emulator | Contrato mínimo e persistência emulador | Canal público funcional e seguro, prova real de contato, proteção contra abuso, prazos |
| Acompanhamento | #1389; KyrubPrivacyTrackingPilot | Consulta por protocolo e código privado, revogação | Recuperação de acesso, prazo e canal seguros, transporte e UI montada |
| Identidade | #1390–1391; privacyCidEvidenceEmulator; PRIVACY_IDENTITY_VERIFICATION_V1.md | Prova de controle de conta/passkey simulada | Associação real, renovação de evidência, representação e atendimento humano alternativo |
| Análise e avisos | #1392–1393; privacyRightsAdminEmulator | Parecer e revisão independentes, avisos fixos | MFA real, concessões, análise de legitimidade, prazos, fila e comunicação operacional |
| Acesso, confirmação, correção | #1394–1395; privacyOwnDataExportEmulator | Perfil e preferências fictícios, correção do nome de exibição, isolamento | Mapear fontes reais, resposta completa, direitos restantes, entrega segura, correção e encerramento; reusar cadastro canônico |
| Consentimentos | #1396; privacyOptionalConsentEmulator; KyrubOptionalConsentPilot | Catálogo fictício, opt-in, versão, revogação | Reconciliar preferências de comunicação, CID/SOS e serviços ativos; retirar tratamento facultativo efetivamente |
| Retenção | #1397; KYRUB_DATA_LIFECYCLE_V1.md | Matriz inicial e classificador puro; compilação corrigida e testes aprovados | Inventário por coleção, prazos e fundamentos, cópias, restauração; nenhum executor nesta cadeia |
| Fornecedores | #1398; KYRUB_PROVIDER_REGISTER_V1.md | Inventário inicial; build aprovado | Contratos e regiões efetivos, subprocessadores, transferências, responsável e contingência |
| Incidentes | #1399; KYRUB_PRIVACY_INCIDENT_RESPONSE_V1.md | Runbook complementar, triagem sintética aprovada na revisão anterior; correção TS em validação | Responsáveis, calendário verificado, comunicação, exercício de mesa completo e revisão jurídica |

## Integração sem duplicação
- Control Plane: AdminControlPlaneApp.tsx e src/utils/adminControlPlane.ts já possuem papéis, manage_compliance, perfil ativo e AdminAccordionSection. Reutilizar os componentes e perfil canônico; permissão de UI não substitui concessão específica no servidor. Não montar componentes de piloto contra Firebase real. Criar navegação de privacidade apenas com adapters autorizados, não conceder poderes automaticamente. Não misturar direitos, incidentes, denúncias SOS ou preservação de evidências.
- Aceites: shared/governance.ts e governanceRepository.ts mantêm documentos e aceites versionados; legalPublicationWritePolicy.ts controla publicação. Não duplicar autoridade nem converter aceite de termos em consentimento opcional. Governança de mudanças existente em shared/governanceReleaseGate.ts.
- Central Pessoal: reusar edição de perfil, preferências de comunicação e identidade da conta. CID: titular sem conta, passkey e alternativa humana. Não tornar cadastro obrigatório para direitos.
- Financeiro: preservar política FinOps, regras de planos e gate Mercado Pago. Retenção de pedidos e registros comerciais exige revisão específica; expiração de visibilidade não equivale a descarte. Preservar gestão de lote e cadastro NFC.
- Segurança: testes isolados não substituem MFA, autorização, testes negativos, segregação do ambiente, proteção de canal e verificação operacional. Não copiar segredos ou dados reais para CI.

## P0 — requisitos de lançamento
1. Confirmar controlador, responsável/encarregado quando aplicável e canal de direitos acessível e funcional, inclusive sem conta.
2. Reconciliar os documentos jurídicos vigentes e a análise de risco por operação com revisão e aprovação humana; publicação via mecanismo existente, sem substituir versões automaticamente.
3. Mapear os tratamentos efetivamente ativos, finalidades/bases, acesso, retenção, fornecedores e transferências. Registrar as lacunas por responsável e evidência.
4. Homologar atendimento operacional completo de direitos: entrada, identidade proporcional, revisão, resposta segura, prazos, casos de terceiros, registro e encerramento. Atendimento humano seguro pode ser suficiente onde a automação não estiver pronta; não confundir aviso com resposta final.
5. Verificar segurança, MFA administrativo e permissões reais, procedimentos de incidente, contatos, calendário e exercício de mesa; validar backup/restauração.
6. Separar capacidades não prontas e impedir ativação indevida; não desligar áreas independentes sem análise de dependências e autorização. Reconciliar com lançamento comercial ERP e CID, sem declarar a V1 pronta apenas pela existência de PRs.

## P1 — após portões operacionais
Automatizar processos já governados: integração de UI e transporte, relatórios, extensão de direitos por módulo, consentimentos efetivos, descarte aprovado e treinamento. Nenhuma automatização vale como aprovação jurídica. Não autorizar exportação de terceiros, acesso a evidências ou exclusão real neste candidato.

## Homologação transversal
Workflow separado em matriz de testes locais: cada suite Firestore/Auth tem emulador próprio para evitar colisão de fixtures. Testes puros separados. A matriz é uma reexecução integrada do código candidato, não E2E de produção, não valida contratos, UI real, envio externo, atendimento jurídico nem operação humana. Não considerar concluída antes de resultados no commit final. Rever árvore de branches e divergências com release de produção antes de qualquer proposta de merge. 
