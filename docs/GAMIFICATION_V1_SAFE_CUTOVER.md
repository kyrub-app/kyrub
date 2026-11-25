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


## G3.2 — Aceitação no marco econômico
Teste adicional no Auth/Firestore Emulator usa cadastro Google fictício com
100 Pitangas reais do gatilho emulado e fixture sintética de 999 sementes
(não representa recibos ou progresso de usuários reais). Pausa e desativação
da flag econômica devem recusar a milésima semeadura sem alterar contador,
projeção, cursor, quota, recibo, ledger ou saldo. Retomada com duas chamadas
simultâneas do mesmo ator deve aceitar uma, reproduzir a outra, registrar uma
Pitanga (saldo 101), quota 1 e XP 0. Pausa após confirmação preserva histórico
e replay. Teste implementado em a42aa04, execução CI pendente.
Não constitui prova de cobertura de escritores, produção, interface de pausa
ou atomicidade de outros processos econômicos.

## Pendências mínimas de encerramento V1
1. Confirmar CI do Control Plane real e do gate de semeadura, sem substituir
   testes de navegador por contratos estáticos.
2. Completar inventário autorizado de escritores efetivos e identidades no
   projeto principal, com evidência de regras/guardas e revisão implantada.
3. Elaborar a autoridade comercial definitiva para créditos de semeadura a
   partir de zero, sem migração de jornada anterior. O piloto atual não pode
   ser liberado apenas trocando flags: sua política de projeto é exclusiva
   de emulador, e a inscrição e o ledger ainda precisam de desenho comercial.
4. Validar custos e limites de leitura/escrita, montagem do transporte real
   com autenticação e controle de frequência, e aceite do app completo.
5. Só então solicitar autorização específica para implantação e ativação
   controladas, com plano de parada e reversão sem perda de histórico.

Não acrescentar migração histórica, punições automáticas, classificadores de
fraude ou novas áreas de produto à V1. O inventário da PR #1274 de Tags é uma
frente independente e não comprova o estado do Firebase principal.


## G3.3 — Início zero sem inscrição manual (piloto)
A opção KYRUB_SEMEADURA_ZERO_START_PILOT somente na entrada release-controlled,
com todos os guards de projeto e emulador preservados, exige autoridade econômica
desde a primeira semente. Para autor sem cursor e projeção zero, verifica
recibo de primeiro login, saldo canônico existente e ledger conciliado sem
créditos anteriores de semeadura. Cria cursor com uma semente na mesma
transação do primeiro recibo/quota/projeção; não cria saldo, crédito ou bônus
novo. Progresso prévio inesperado, saldo divergente ou ausência de evidência
bloqueiam a transação. Sem fallback silencioso para visual-only neste modo.
Mantém a entrada anterior de fixture para regressões.
Teste 9fe76df verifica rejeição de progresso inesperado/saldo divergente e
duas chamadas concorrentes criando uma inscrição, um recibo e uma quota,
sem alteração do saldo. CI pendente. O requisito comercial ainda não está
completo: a verificação atual exige baseline welcome validada; usuários
preexistentes ou sem bônus Google precisam de autoridade própria, não de
migração da Jornada Pitangueira. Não limitar elegibilidade comercial ao bônus
por acidente. A entrada e a configuração seguem proibidas em produção,
nenhum cadastro real inscrito. Novo blob do serviço exige revisão do
inventário estático. Sem modificações de dados, flags, cobrança ou PR #1274.


## G3.4 — Contas sem bônus de boas-vindas (piloto isolado)
O direito à jornada não depende de ganhar as 100 Pitangas. Para iniciar do zero
sem saldo anterior, exige-se identidade do autor obtida via Auth confiável,
cadastro anterior ao corte da campanha ou evidência original de onCreate
não-Google, ausência de recibo welcome e ledger vazio. Não inferir
inelegibilidade apenas pela lista atual de provedores; cadastro Google elegível
com evento/recibo pendente deve aguardar a autoridade de boas-vindas. O corte
da campanha precisa permanecer fixado para a futura ativação.
O piloto reutiliza o bootstrap canônico já existente com checkpoint de zero
entradas e saldo zero, sem crédito, reconstrução de histórico ou migração da
Jornada Pitangueira. A coleção técnica de recibo de bootstrap mantém o nome
legado pitangaMigration; sua reutilização evita inventar outra autoridade de
saldo e preserva a compatibilidade estrutural com a conversão canônica.
No marco de 1.000, a autoridade zero-history revalida o recibo, digest vazio,
epoch/fence e concilia saldo/ledger antes do crédito. Flag experimental
KYRUB_SEMEADURA_NO_WELCOME_PILOT exclusiva de emuladores; prova de registro
não-Google é escrita apenas pelo gatilho confiável no piloto.
Teste 5516656 usa cadastro por senha via Auth Emulator, aguarda evidência
de onCreate, verifica ausência de bônus, rejeição sem evidência, inscrição
concorrente com saldo zero e marco sintético de 999 para 1.000 com crédito
único de uma Pitanga, XP zero. CI pendente; ainda falta validar especificamente
cadastro anterior ao corte, corrida com welcome pendente, conversão de conta
zero-history e demais estados econômicos preexistentes. Não criar nova migração
de jornada, não alterar saldos reais. O CI de 86a63a0 passou 4/4; revisão do
gate econômico posterior ainda pendente. Inventário externo e aprovação
comercial continuam obrigatórios. Nenhuma alteração em produção/PR #1274.


## Decisão definitiva — corte da campanha de boas-vindas (24/11/2026)
O proprietário confirmou que contas criadas antes do início oficial da campanha
não recebem 100 Pitangas retroativamente. Sem compensação, reabertura de
elegibilidade ou concessão por login posterior. A data efetiva comercial ainda
deve ser fixada na ativação autorizada; a data de fixture não é data comercial.
Cadastro anterior à campanha continua podendo participar da Jornada Pitangueira
a partir de zero, sem bônus ou migração histórica. Preservar o teste existente
de old registration ineligible; não criar frente de recuperação de bônus.
CI dos commits efb4174 (pausa no marco econômico) e 169dd50 (início automático):
4/4 workflows aprovados em cada revisão. Teste ampliado 0adbd53 reutiliza a
conversão canônica para a conta sem boas-vindas: recusa com saldo 1, sem alterar
extrato, e fronteira sintética de 1.000 Pitangas (999 de fixture exclusivamente
descartável + 1 do marco emulado), duas requisições idênticas concorrentes,
um débito de 1.000, um XP, saldo zero e histórico da jornada intacto.
Não é uma nova fonte de recompensa. CI dessa ampliação e da autoridade
sem boas-vindas pendente. Próximo portão: confirmar os testes e concluir
auditoria de custo e cobertura de escritores, sem aumentar escopo.


## G3.5 — Admissão econômica obrigatória no transporte
Revisão do fluxo identificou que o adaptador release-controlled anterior
podia aceitar nova semente sem inscrição econômica se ZERO_START_PILOT
estivesse desligado. Não utilizar esse adaptador como entrada pública.
A rota semear agora chama seedEconomicallyAdmittedPost exclusivamente
(6a1d110), que exige gate de abertura, fence, política de início zero,
política de contas sem welcome e Auth do projeto de emulador confiável
antes de escrever nova quota, recibo, projeção ou crédito. A inscrição
econômica é obrigatória mesmo se uma configuração falhar; ausência de
flags rejeita a operação. O cursor econômico estrito rejeita autoridade
de moeda desconhecida. Replay de recibo validado permanece possível,
sem nova quota, após pausa; não cria crédito retrospectivo.
Adaptadores antigos permanecem apenas para regressões isoladas.
Testes cd84e45 e 8038974 exercitam a entrada pública nos fluxos de
cadastro elegível e não-Google, ausência das flags, preservação de
estado e contrato do handler. CI pendente. Manifesto de fonte revisado
em 6066ca5, sem declarar cobertura externa.
Esta é a fronteira de admissão necessária para a futura autoridade
comercial, NÃO autorização comercial: projeto, epoch, flags e guardas
continuam exclusivos de emulador. Nenhuma migração de jornada,
concessão retroativa, alteração de regras, serviços pagos, deployment
ou edição de dados reais. A promoção precisa de política de projeto
e epoch próprios, evidência de todos os escritores, configuração de
campanha imutável e revisão da autoridade econômica e controles de
ativação; não remover guardas experimentais para simular conclusão.
