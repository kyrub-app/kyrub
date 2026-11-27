# Kyrub — Programa de Governança em Privacidade V1
Data: 26/11/2026. Proposta interna, não publicada, sujeita à validação jurídica e operacional. Não atesta conformidade. Complementa docs/PRIVACY_SECURITY_READINESS.md, não substitui documentos vigentes. Reconciliar handoff #1315/#1316 e PRs posteriores; base documental CID #1384, não incorpora rascunho #1385.

## Diretrizes permanentes
Privacy by Design, Privacy by Default, Security by Design e Compliance by Design: finalidade explícita, necessidade, base legal por operação, privacidade inicial, autorização no servidor, transparência, segurança, descarte, direitos e evidência. Nenhuma funcionalidade nova recebe aprovação comercial só por passar no build. Separar condições de liberação por capacidade: recursos de risco não comprovado ficam desativados, sem bloquear áreas independentes se tecnicamente segregadas. Não contratar, ativar produção ou criar contas reais nesta etapa.

## Prioridades
| Frente | Entregável mínimo antes de ativar a capacidade | Evidência |
|---|---|---|
| Registro de operações (ROPA, art. 37) | Por finalidade: dados, titulares, fluxo, controlador/operador, base legal, destinatários, região, retenção, acesso e responsável | Inventário reconciliado com código, Firestore, Storage, logs e fornecedores |
| Bases legais | Contrato, obrigação legal, consentimento específico, legítimo interesse com avaliação quando aplicável, proteção da vida quando cabível; art. 11 para sensíveis | Revisão jurídica; não presumir consentimento geral |
| Direitos (arts. 18–20) | Canal gratuito sem conta obrigatória; confirmação/acesso, correção, eliminação/anonimização/bloqueio conforme hipótese, portabilidade aplicável, informação de compartilhamentos, revogação, oposição, revisão de decisão automatizada quando cabível | Protocolo, identidade proporcional, registro de prazos, resposta segura, teste de isolamento e casos de terceiros |
| Retenção/descarte (arts. 15–16) | Política por categoria, evento inicial, duração, obrigação/justificativa, responsável, exceção aprovada, eliminação/anonimização, cópias e restauração | Teste de descarte, não reaparecimento após restaurar backup e retenções legais separadas |
| Incidentes | Responsável, classificação, contenção, preservação proporcional, comunicação ANPD/titulares quando houver risco ou dano relevante | Simulação de incidente, relógio de prazos, contatos reais, registro de decisões |
| Fornecedores | Inventário real de Firebase/Google, Vercel, Mercado Pago e demais integrações ativas; qualificação por operação, subprocessadores, região, transferência internacional, contrato, incidentes e exclusão | Contratos/termos verificados, mecanismo de transferência aplicável, revisão de configuração |
| RIPD | Prioridade CID/SOS, localização, eventual dado de saúde, idade/identidade, futuros anúncios e decisões de alto risco | Descrição, necessidade, alternativas, ameaças, risco residual, medidas/testes, decisão e revisão |
| Governança | Identificar controlador real, responsável/encarregado quando exigido, canal público funcional mesmo se dispensado, treinamento proporcional, revisão periódica | Registro de designação/contato, evidência de revisão e responsável |

## Central de Privacidade (proposta)
Central Pessoal: entrada Privacidade e meus dados. CID: entrada correspondente na Central do Titular e canal público para visitantes/contatos sem conta. Não criar conta compulsoriamente. Operador interno usa Control Plane com concessão própria e auditoria, não a fila de denúncias SOS para direitos LGPD. Protocolo separado, verificação proporcional ao risco, prevenir enumeração e vazamentos, confirmação simplificada imediata ou declaração completa em até 15 dias para confirmação/acesso (art. 19, observar regulamentação aplicável); demais prazos validados individualmente. Nenhuma cobrança. Exportar dados do solicitante sem expor dados de terceiros. Revogar consentimento tão fácil quanto conceder; não usar aceite dos termos como consentimento universal. Eliminação de conta não equivale a apagar pedidos, registros fiscais ou outras retenções justificadas. Informar motivo e escopo de eventual retenção. Inicialmente atendimento manual seguro e testado pode suprir automação, desde que canal efetivo, responsável, prazo e procedimento existam.

## Critérios de engenharia
- Cada PR que altera tratamento de dados inclui finalidade, campos novos, destinatários, base legal candidata, retenção, permissões, aviso, testes negativos e avaliação de impacto. Sem dados reais em testes, logs ou screenshots.
- Controle de acesso mínimo, verificação de titularidade/tenant no servidor, MFA real para funções sensíveis; acessos negados, revogados, concorrentes e legados testados. Não registrar tokens, chaves Pix ou conteúdo SOS em telemetria.
- Consentimentos por finalidade e versão, prova proporcional e retirada efetiva. Publicação de CID é opção explícita; dados de contatos e localização privados por padrão.
- Incidente: regra geral de comunicação em 3 dias úteis para risco/dano relevante, a partir do conhecimento pelo controlador, observar exceções normativas e elegibilidade a tratamento diferenciado; adotar internamente prazo conservador. Não presumir enquadramento de pequeno porte.
- Logs de acesso a aplicações: avaliar Marco Civil art. 15 (se aplicável, seis meses), sem confundir indicador de último acesso com registros legais; retenção cautelar e disponibilização conforme art. 10/15 e revisão jurídica. Não coletar dados adicionais por conveniência.
- Segregação de controladores e operadores no ERP: avaliar cada finalidade, inclusive lojistas/empregadores e respectivos clientes/staff; não presumir que todos tenham o mesmo papel.
- Aferição 18+, comunicação com terceiros e exposição pública: reavaliar proteção de crianças/adolescentes, inclusive visitantes e destinatários que não são usuários, à luz das normas aplicáveis; não prometer que idade declarada ou restrição de cadastro resolve o risco.
- Kyrubia continua fora da V1 comercial; não atribuir processamento LLM ativo a funcionalidade desligada. Não reutilizar SOS/saúde/localização para anúncios, gamificação, treinamento ou perfil comercial.

## Portões de liberação
P0: confirmar identidade/controlador e canal; validar documentos publicados; inventário/base legal/retencão dos fluxos ativos; atendimento de direitos testado; fornecedores/segurança/incident response; revisão de riscos de CID e controles de publicação, consentimento e SOS. Recursos simulados seguem isolados. P1: automatizar atendimento e descarte já governados, ampliar painel de métricas não identificáveis, auditoria e treinamento. P2: revisar a cada alteração de risco, fornecedor, finalidade e lançamento. Não certificar LGPD com base apenas em documentos, CI ou uma lista de verificação.

## Fontes oficiais consultadas
- LGPD consolidada: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm (arts. 6, 7, 8, 9, 11, 15–20, 33, 37–38, 41, 46–50).
- ANPD, RIPD: https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/relatorio-de-impacto-a-protecao-de-dados-pessoais-ripd
- ANPD, direitos: https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1/direito-dos-titulares
- ANPD, incidentes: https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis
- Resoluções ANPD 2/2022, 15/2024, 18/2024 e 19/2024: https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/
- Marco Civil: https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm
