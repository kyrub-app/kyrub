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
- Enrolamento econômico: o piloto só aceita estado coerente com seu ledger; contas
  com progresso visual anterior e marcos sem créditos exigem uma política de
  baseline explícita e testes antes de enrolamento real. Não fabricar créditos,
  recibos nem cursor, não transformar marcos históricos em saldo automaticamente.
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
Qualquer ativação econômica e eventual migração precisam de autorização própria.

Este roteiro não pressupõe que algum serviço esteja ativo ou ausente, não prova
estado atual de flags e não autoriza deploy, merge, billing ou alteração de dados.
