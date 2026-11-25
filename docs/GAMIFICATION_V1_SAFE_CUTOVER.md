# KYRUB — Transição segura da gamificação V1

Status: **não autorizada para produção**. Este roteiro não é uma execução de cutover.
Escopo exclusivo: projeto Firebase principal `kyrub-b8d0e`, banco (default), e
deployment Vercel do projeto kyrub. Não atuar em `kyrub-tags` nem na PR #1274.

## G0 — Evidências já existentes (reutilizar)
- Relatório PITANGA_WRITER_DEPLOYMENT_EVIDENCE.md de 24/11/2026: ambos os domínios
  apontavam para dpl_9P1QiBsF6XJmucEgFM8h6hvYVQgS, SHA 5106d53fa1e5f7450e7597d6523ae40d1c03cdae.
  Revalidar antes de qualquer decisão, pois aliases são móveis.
- Candidata PR #1277: fixar novo SHA e conferir CI, inclusive os artefatos do
  inventário. Resultado positivo de job de coleta não significa release gate aprovado.
- O código de produção ainda tem projeção coletiva de comunidades e não possui a quota nova.
  Não habilitar a versão antiga.

## G1 — Inventário autorizado, somente leitura
Usar sessão autorizada já existente no Console Firebase/Google Cloud e Vercel.
Não habilitar APIs, Blaze, serviços, criar chaves, baixar credenciais, mudar IAM,
configurar ou chamar funções de escrita. Não executar teste com usuários reais.
Para cada consulta, registrar data/hora, projeto, região, escopo, página,
status, quantidade, fonte e limitações. Seguir toda paginação autorizada.
Distinguir vazio confirmado, acesso negado, API desabilitada e consulta incompleta.

| Fonte | Evidência a coletar |
|---|---|
| Firebase/GCP Functions Gen1 e Gen2 | Inventário em todas as regiões, revisão, gatilho, identidade, versão ativa |
| Cloud Run serviços e jobs | Revisões com tráfego, jobs, identidade e versão |
| Cloud Scheduler, Pub/Sub, Cloud Tasks e Eventarc | Gatilhos, filas, consumidores, destinos, regiões, sem segredos |
| IAM e contas de serviço | Identidades com possibilidade de escrita direta/indireta no Firestore, vínculos herdados/condicionais/customizados quando visíveis; metadados de chaves, não material secreto |
| Vercel | Deployment dos aliases e revisões acessíveis com credenciais do Firebase principal, funções/rotas/filas, nomes e escopo das variáveis (nunca valores secretos) |
| Logging/Monitoring quando disponíveis | Evidência de uso e limites de cobertura/retenção; ausência de evento não prova ausência de escritor |
| Firestore | Inspeção autorizada somente leitura do fence, regras ativas e configuração; não listar dados pessoais nem executar consultas massivas |

Para cada escritor confirmado ou possível, mapear workload/serviço, responsável,
revisão ativa e SHA, gatilho, identidade (em relatório privado), coleções de
destino e verificação do fence dentro da transação. Incluir clientes legados,
Admin SDK, REST, projetos externos, deployments antigos e revisões que ainda
aceitam chamadas. Classificar como não escritor comprovado, escritor protegido,
escritor a retirar, ou desconhecido. Atestação de chave preexistente é apenas
prova de posse, não prova origem do runtime ou cobertura completa.
Se não houver acesso, registrar bloqueio exato e prosseguir nas fontes acessíveis.
Não declarar writersVerified=true. Relatório sem credenciais e sem dados de usuários.

## G2 — Compatibilidade e plano de dados
- Preservar recibos canônicos preexistentes, inclusive anteriores a quotaDay,
  autoria, histórico de comunidade e saldos/XP. Nenhum recálculo ou crédito retroativo.
- Teste de regressão dedicado no emulador: recibo antigo continua irrevogável,
  repetição não consome nova quota; nova semente pertence ao autor e não toca
  projeção coletiva histórica. Não atribuir créditos ao passado.
- Quota por dia em America/Sao_Paulo: registros antigos do mesmo dia não possuem
  quotaDay. Não somar somente a quota nova e afirmar limite diário retrospectivo.
  Preferir, como proposta operacional sujeita a aprovação, bloquear e comprovar
  cessação de todas as entradas antigas antes da virada do dia local, iniciar
  quota apenas no primeiro dia completo da nova versão, sem permitir escritores
  antigos em paralelo. Se não for possível provar a cessação, bloquear lançamento.
  Qualquer reconstrução de quota necessita procedimento próprio, auditado.
- Decisão do proprietário em 24/11/2026: a Jornada Pitangueira ainda não possui progresso anterior de usuários reais. Portanto, retirar migração, baseline retrospectivo e reconstrução de histórico do escopo da V1. Início do progresso a partir de zero. Não executar limpeza de registros de teste no ambiente real por suposição. Caso a conferência pré-ativação revele estado inesperado, parar e comunicar; não criar migração preventiva nem conceder crédito retroativo. Preservar testes de compatibilidade já feitos como regressão, sem nova frente de desenvolvimento.
- Preservar os contratos de 100 Pitangas por primeiro cadastro Google elegível,
  2 XP conforme autoridade canônica existente, conversão voluntária 1000:1.
  Validar o corte temporal de campanha e a identidade do projeto; sem prêmio por
  consulta a desafio ou ocultação de loja.

## G3 — Candidata comercial
A PR #1277 é piloto; os guards atuais proíbem produção. Não reaproveitar flags de
emulador, identidades fixtureOnly ou rotas loopback como autorização de produção.
Preparar separadamente revisão do transporte real, autoridade de acesso,
cobertura de escritores, versão de regras, custo operacional e testes do app
completo em ambiente isolado. Sem ampliar detector de fraude ou sanções nesta V1.

## G4 — Aprovação operacional futura
Exigir evidências de G1–G3 e autorização separada do proprietário para mudanças.
Definir sequência de desabilitação dos escritores legados, comprovação de corte,
ativação protegida de nova versão e verificação de flags/fence. Registrar revisão
anterior e plano de parada. Não reativar escritores antigos após lançamento de
recibos/quotas novos, nem efetuar rollback de saldo ou apagar histórico.
Interromper novas operações por kill switch aprovado se houver inconsistência.
Qualquer ativação econômica precisa de autorização própria. Migração histórica da Jornada Pitangueira fora do escopo, conforme decisão do proprietário.

Este roteiro não pressupõe que algum serviço esteja ativo ou ausente, não prova
estado atual de flags e não autoriza deploy, merge, billing ou alteração de dados.


## G3.1 — Interrupção transacional (contrato experimental)
A entrada pública de novas sementes agora delega a seedReleaseControlledPost.
O gate lê systemControl/semeaduraReleasePilot e o fence na mesma transação,
antes de quota, recibo, projeções e liquidação. Exige flag experimental,
projeto/epoch de emulador, versão de esquema, status open, instante de início,
revisão válida e fence verificado. Ausência, pausa, projeto incorreto ou data
futura recusam novas sementes sem movimentar estado. Leituras e replay de
recibos existentes continuam possíveis se o transporte estiver ligado.
A pausa não desfaz transações já confirmadas. A prova de isolamento depende
de todos os escritores respeitarem a mesma fronteira; a entrada de fundação
seedVerifiedPost permanece para testes confiáveis, não deve ser usada por
transporte público. O auditor deverá revisar o novo blob de semeaduraService.ts.
Testes do gate ausente/desligado, pausa, preservação de recibo, retomada e quota
foram adicionados no Auth/Firestore Emulator, CI pendente. O teste usa conta
não inscrita (sem liquidação econômica); não comprova pausa de crédito no marco
de 1.000 nem operação real. O gate deliberadamente não admite produção;
flag experimental não é configuração comercial. Nenhuma escrita real,
nenhuma API administrativa de ativação, alteração de IAM, regras ou cobrança.
Próximo aceite: confirmar CI e estender teste ao marco econômico antes de
considerar desenho da autoridade de lançamento definitiva.
