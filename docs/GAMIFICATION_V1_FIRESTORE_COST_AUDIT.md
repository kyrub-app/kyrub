# Auditoria de custo operacional — Gamificação V1
Data: 24/11/2026. Código inspecionado: e773914bfa688cbae9a2b237c9ac564bd1774b93.
Escopo: estimativa estática de operações, não medição de consumo ou fatura.
Nenhuma consulta de uso real do Firebase autorizada/disponível nesta sessão.
Projeto principal kyrub-b8d0e; região, edição, plano e consumo atuais a confirmar.
Não habilitar Blaze, TTL, backups pagos, jobs ou faturamento.

## Cotas e referência
Firestore Standard: 50.000 leituras, 20.000 gravações, 20.000 exclusões por dia,
1 GiB armazenado, 10 GiB/mês de saída. Uma base gratuita por projeto. Cotas
reiniciam próximo à meia-noite do Pacífico, não à meia-noite de Brasília.
Fontes consultadas em 24/11/2026:
https://firebase.google.com/docs/firestore/quotas
https://firebase.google.com/docs/firestore/pricing
https://cloud.google.com/firestore/pricing
https://firebase.google.com/docs/firestore/best-practices
Tabela exibida na página de preços para Iowa: USD 0,03/100 mil leituras,
USD 0,09/100 mil gravações. Apenas referência de simulação, não preço
confirmado da região do Kyrub. Valores acima da cota, sem descontos contratados.

## Inventário de operações (uma tentativa, sem retries)
- Status por publicação pessoal: 4 gets (post, contador, recibo, quota).
  Comunitária: 6 (adiciona comunidade e vínculo). Cada consulta repete quota.
- Nova semente pessoal em autor já inscrito no modo econômico controlado:
  12 gets lógicos (post/contador/recibo/progresso=4, gate/fence=2, quota=1,
  cursor/fence=2, holds=3), 5 writes (recibo, contador, quota, progresso,
  cursor). Comunitária: 14 gets, 5 writes. +1 write se fila incremental ligada.
  Fence lido duas vezes; custo faturável exato precisa medição.
- Replay antes do gate: 4/6 gets, zero writes.
- Cada hold existente acrescenta leitura de evento de auditoria.
- Marco econômico: adicional de leitura de recibo de boas-vindas, autoridade
  de saldo, entrada específica e coleção integral rewardLedger. +2 writes
  (saldo e lançamento), além das cinco usuais. Inscrição inicial também lê
  ledger e autoridade; bootstrap saldo zero adiciona dois writes.
  Consultas vazias podem custar uma leitura. Não tratar ledger integral como
  custo constante. Extrato pitangaAccount também lê integralmente rewardLedger e xpLedger.
- Journey: 1 get por consulta; observadores/eventos podem multiplicá-las.
- Painel administrativo: snapshot incremental tem custo fixo de consulta
  mais autorização; refresh lê até 201 registros por conta, mais projeções,
  contribuição anterior e fila. Indícios: até 501 recibos por inspeção.
  Não executar varreduras recorrentes ou fila automática na V1.
- Frontend SemearButton consulta ao entrar na área visível, refresh após
  semear, eventos de sincronização e checagem de mudança de dia quando esgotado.
  A mesma publicação pode ser montada em telas diferentes. Não há rate limit
  de consultas equivalente à quota de sementes; quota de 100 protege aceites,
  não volume de solicitações.

## Modelo ilustrativo para orçamento
Hipóteses: 40 consultas de status iniciais/pessoa/dia, 10 sementes aceitas,
uma nova consulta por aceite, metade pessoal/metade comunitária,
autores já inscritos, sem fila, marcos, inscrição, retries ou demais módulos.
Leituras/dia = usuários * (40*5 + 10*(13+5)) = 380*usuários.
Gravações/dia = 50*usuários.
| Usuários ativos/dia | Leituras/dia | Gravações/dia | USD/mês ilustrativo excedente* |
|---:|---:|---:|---:|
| 100 | 38.000 | 5.000 | 0 |
| 500 | 190.000 | 25.000 | 1,395 |
| 1.000 | 380.000 | 50.000 | 3,78 |
| 10.000 | 3.800.000 | 500.000 | 46,71 |
* 30 dias uniformes, cota integral atribuída hipoteticamente à gamificação,
taxas Iowa acima, sem armazenamento, índices cobrados, tráfego, Vercel,
Auth, Functions, impostos ou demais módulos. Não é previsão de fatura.
Limite teórico ~131 usuários nesse cenário se nenhuma outra leitura ocorrer;
não é limite de cadastros nem recomendação de capacidade.
100 sementes aceitas/dia com uma leitura status antes e outra depois:
aprox. 2.000–2.600 gets e 500 writes por usuário no caso simples.
As cotas são compartilhadas com ERP e app; plano sem cobrança pode bloquear
operações quando esgotadas, não converter excedente automaticamente em custo.

## Prioridades mínimas de otimização antes da ativação
1. Deduplicar consultas simultâneas de status por sessão/publicação; não cachear
   permissões de escrita; invalidar na troca de conta, após aceite e na virada
   da quota. Não substituir o recibo canônico por cache.
2. Agrupar status de publicações visíveis em lotes pequenos, compartilhando
   leitura de quota e de comunidade/vínculo por lote. Firestore cobra documentos
   lidos, não apenas chamadas HTTP; não prometer economia sem contar documentos.
3. Reduzir consultas redundantes pós-aceite mediante retorno autoritativo da
   mesma transação, sem inferir crédito ou liberar semeadura duplicada.
4. Manter inspeções administrativas por demanda e paginadas; não varrer ledger
   global nem recibos em cada interação. Medir contenção do contador da
   publicação, progresso do autor, quota e cursor. Não remover fences/holds
   ou recibos para economizar. Revisar crescimento de extrato e ledger antes
   de impor limites que poderiam bloquear recompensas legítimas.
5. Solicitar relatório somente leitura do Console: região/edição/plano,
   leituras/gravações/exclusões por dia nos últimos 7 e 30 dias,
   armazenamento/índices e tráfego; picos, consumo de outros módulos,
   limites e margem restante. Não expor segredos, nem executar carga real.
6. Validar contagem com teste instrumentado no emulador; emulador não reproduz
   faturamento. Definir orçamento operacional somente com decisão do proprietário.
   Alertas de orçamento não são teto rígido de gastos.

Sem alteração funcional nesta auditoria. Próximo passo: otimização focada
de consultas de status e validação de regressão. Sem ativação comercial,
migração histórica, mudanças de flags, faturamento ou PR #1274.


## Otimização 1 — consultas redundantes
CI da revisão 952b8bb: 4/4 workflows aprovados. A entrada controlada retorna
a quota restante e dia já obtidos da transação de aceite, sem leitura adicional.
O componente consome a resposta confirmada, mantém bloqueio irrevogável,
não faz nova consulta própria se a resposta for válida, e não reage ao seu
próprio evento. Réplicas de cards podem consultar novamente; consultas
simultâneas por objeto de sessão/ação/publicação/dia são compartilhadas,
com cancelamento individual e invalidação ao iniciar/terminar mutação.
Nenhum cache de resposta concluída, nenhuma autorização baseada em cache,
nenhuma mudança em recibos, fences, holds ou limites. Respostas anteriores
sem quota conservam caminho de consulta. Testes de coalescência, isolamento,
cancelamento e contratos adicionados; novo CI pendente.

Estimativa mantendo o modelo anterior: cada aceite evita uma consulta própria
de 4–6 documentos (média 5). Com 100 mil aceites/dia, até 500 mil leituras/dia
a menos nesse caminho, antes de retries, outras réplicas e demais módulos.
No cenário ilustrativo 2 milhões de leituras e 500 mil gravações/dia:
1,5 milhão de leituras/dia, mesmas gravações; USD 26,01/mês versus 30,51,
redução USD 4,50/mês pelas taxas hipotéticas de Iowa. Não medido em produção.
Os 40 status iniciais e 100 aceites do cenário anterior são variáveis
independentes de carga, não uma jornada de interface em que 40 posts distintos
possibilitam 100 sementes. Um usuário precisa encontrar 100 posts elegíveis
distintos para esgotar a quota. A economia adicional de eliminar duplicação
de consultas concorrentes depende da navegação e não foi somada.
Agrupamento de publicações distintas, medição instrumentada, inventário
externo e orçamento efetivo continuam pendentes. Nenhuma mudança em produção.


## Otimização 2 — lotes de status
Ação read-only status_batch no transporte existente, com 1–10 alvos distintos,
campos estritos, UID derivado da autenticação e validação independente de cada
post. Reutiliza a mesma lógica de status individual. Uma leitura de quota
por lote e uma leitura de comunidade + vínculo por comunidade distinta,
sem cache entre requisições. Resultado indisponível por alvo é null, sem
metadados privados. A interface agrega pedidos da mesma sessão por até 12ms,
com máximo de 10; preserva a coalescência anterior e valida correspondência
entre alvos e respostas. Cancelamentos anteriores ao envio excluem o alvo;
requisição coletiva já enviada pode concluir, mas respostas canceladas ou
de outra sessão não devem chegar à interface. Não existe cache persistente.
Nenhuma alteração na transação de semeadura, quota, crédito ou holds.
Contagem lógica prevista por 10 posts válidos:
- pessoais: 40 -> 31 leituras (22,5% de redução);
- comunitários da mesma comunidade: 60 -> 33 (45%);
- comunitários de 10 comunidades distintas: 60 -> 51 (15%).
Não se trata de redução proporcional da fatura total. Lotes incompletos,
ritmo de scroll, retries e outros módulos afetam o resultado.
Teste FakeDb instrumenta 60 versus 33, compara resposta com consultas
individuais e verifica ausência de escritas, comunidade privada, limite,
duplicatas e injeção de UID. Teste de cliente verifica divisão 10+1,
isolamento e correspondência das respostas. Novo CI pendente; revisão
6c3f755 tem 3 workflows aprovados e Store security rules em andamento
na consulta. Ainda não há medição em navegador/emulador do transporte
agrupado ou dados de consumo reais. Sem deploy, faturamento ou PR #1274.


## Otimização 3 — extrato pessoal e resumo administrativo
Pitangas e Semeadura do Control Plane já utilizam o mesmo snapshot derivado:
duas leituras de autorização e uma do resumo, sem varredura global. A troca
entre essas duas visões preserva o componente e a consulta, com atualização
manual explícita e data/limitações de cobertura visíveis. A troca de sessão
ou área de investigação remonta o painel. Chromium instrumenta o número
de requisições do snapshot: 1 na abertura, 0 adicionais na troca de área,
1 adicional no refresh. Não há cache persistente nem mudança de autoridade.
Extrato pessoal: compartilha consultas simultâneas do mesmo objeto Auth,
não conserva respostas concluídas, invalida na conversão e atualização
explícita; sessão alterada remonta o estado e descarta respostas antigas.
Renderiza 20 lançamentos por vez, mostrar mais não faz nova consulta.
Teste UI instrumenta uma consulta para dois painéis simultâneos, mantém
idempotência da conversão e verifica expansão local.
Importante: a reconciliação integral de rewardLedger e xpLedger ainda
ocorre no servidor. Limitar renderização NÃO reduz documentos lidos nem
tamanho da resposta inicial. Não substituir saldo reconciliado por projeção
não verificada; paginação real com total confiável requer autoridade de
projeções transacionais de TODOS os escritores de Pitanga/XP e verificação
de regras/versões. Não desenvolver projeções paralelas por suposição.
Próximo portão: medir transporte agrupado no emulador e concluir inventário
externo dos escritores, região e consumo antes de decidir otimizações
adicionais. CI 2604f0a em execução na consulta; CI desta revisão pendente.
Nenhuma alteração no Firebase real, faturamento, deployment ou PR #1274.


## Aceitação instrumentada e orçamento consolidado
Commit 9318b92 adiciona cenário real de Firestore Emulator kyrub-security-test:
o adaptador de contagem delega cada get à SDK Admin real, sem expor escritores.
Compara status individuais e lotes em 10 posts pessoais, 10 da mesma comunidade
e 10 de comunidades diferentes. Exige respectivamente 40→31, 60→33, 60→51,
uma quota por lote, equivalência de respostas, recibos e quota 98 preservados,
negativa após revogação de vínculo e nenhum crédito adicional. CI pendente.
Isto mede chamadas lógicas da SDK, não faturamento, retries de rede ou índices.
Não é teste de carga nem prova de desempenho do transporte HTTP em produção.

### Cenário de orçamento corrigido para 100 sementes diárias
Para cada um dos 1.000 usuários esgotar a quota, considerar ao menos 100
publicações elegíveis distintas consultadas por dia, em vez de 40. Hipótese:
100 status iniciais, 100 aceites, 50% pessoal/50% comunitário, autores já
inscritos, sem fila incremental, sem holds existentes, lotes completos
quando aplicáveis, sem retries, marcos econômicos ou outras telas.
Mantém as taxas ilustrativas de Iowa e cota integral atribuída à gamificação
(50 mil reads, 20 mil writes/dia); mês uniforme de 30 dias.
| Cenário | Leituras/dia | Gravações/dia | USD/mês |
|---|---:|---:|---:|
| Individual + leitura pós-aceite | 2300000 | 500000 | 33.21 |
| Sem leitura pós-aceite, sem lotes | 1800000 | 500000 | 28.71 |
| Lotes de 10, 50% pessoal e 50% comunitário na mesma comunidade | 1620000 | 500000 | 27.09 |
| Lotes de 10, 50% pessoal e 50% comunitário em comunidades distintas | 1710000 | 500000 | 27.90 |
A economia condicional de leituras dos lotes completos no cenário concentrado
é 680 mil/dia versus a primeira linha; não somar outras economias não medidas.
As 40 novas postagens por pessoa/dia, se ocorrerem, totalizam 1,2 milhão
de publicações/mês; criação, mídia, comentários, entregas e ERP permanecem
fora desta simulação. O cenário anterior de 40 consultas independentes
não deve ser interpretado como 40 publicações criadas.
Sem afirmar região, edição, plano, preços contratados ou consumo do Firebase
principal. Próxima ação necessária: inventário autorizado de escritores e
levantamento real de uso do projeto principal; não abrir nova frente de
otimização sem identificar gargalo medido. Sem alteração em produção.


## Conferência pré-lançamento — 24/11/2026
Revisões 6c3f755 e 2604f0a: 4/4 workflows aprovados.
Revisão 94e034f: Chromium aprovado; Application build 45529044050,
job 138919482032, artefato 14982674838 inspecionado. Prebuild executou
2527 testes, 2526 passaram, 1 falhou no contrato textual de
personal-center-wallet.test.ts, que exige mode = 'all'. A correção
9da914d restaura a assinatura pública original, sem modificar ou suprimir
o teste. Novo CI pendente. O mesmo log npm ci reporta 10 vulnerabilidades
(1 baixa, 7 moderadas, 2 altas); não identifica aqui explorabilidade.
Antes da liberação, revisar o relatório npm audit de dependências
de produção, sem aplicar npm audit fix --force automaticamente.
Revisão instrumentada f5e896b ainda sem confirmação integral.
Não afirmar conclusão de homologação.

### Handoff mínimo de infraestrutura
Não há ação de consulta direta ao Google Cloud/Firebase nesta sessão.
Executar G1 de GAMIFICATION_V1_SAFE_CUTOVER.md no projeto principal
kyrub-b8d0e, banco (default), via sessão autorizada do Work.
Além do inventário de escritores, registrar edição e localização do banco,
plano de cobrança, uso diário de leituras/gravações/exclusões nos últimos
7 e 30 dias (quando disponível), armazenamento e consumo de outros módulos.
Distinguir ausência de serviço comprovada, acesso negado, API desabilitada
e consulta incompleta. Verificar a revisão Vercel vinculada aos domínios
www.kyrub.com e admin.kyrub.com. Não copiar segredos, dados de usuários,
habilitar APIs, alterar IAM, Blaze, regras, flags, dados ou fazer deploy.
Não definir writersVerified. O relatório deve listar bloqueios remanescentes
e evidências com data, projeto e fonte. Projeto kyrub-tags e PR #1274 fora
do escopo. A autoridade econômica comercial ainda exige implementação
e aceite separados: o piloto atual permanece exclusivo de emuladores.
Não ampliar as otimizações até a evidência de consumo e cobertura.


## Evidência CI e triagem de dependências
Revisão fb638f0: Application build, Store security rules e Chromium aprovados.
Job 138921387895, workflow Welcome 45529616596: 75/75 contratos, 10/10
Firestore Semeadura e 26/26 outros testes emulador. Logs registram
personal 40 -> 31, community 60 -> 33 e community 60 -> 51: contagem lógica
SDK confirmada em emulador, não fatura. Job Auth 138921388038: 18/19,
incluindo inscrição automática e conta sem bônus com conversão aprovadas.
Falha no teste antigo de cadastro não-Google que fabricava evento concorrente
com o onCreate real. Commit b24de6e corrige a fixture para replay de evidência
real e exige rejeição de ID conflitante; não flexibiliza o serviço.
CI da correção pendente. Manifesto estático de chamadas atualizado em
5a44651, sem atestar escritores implantados.

Inventário de dependências badd8d9, workflow 45530117843, root job
138923037467 e functions job 138923037674: ambos relatórios concluídos.
- Root completo: 1 baixa, 7 moderadas, 2 altas, 0 críticas.
- Root npm audit --omit=dev: 1 baixa, 6 moderadas, 0 altas/críticas.
- Functions completo e produção: zero apontamentos nessa consulta.
As duas altas são uma cadeia de desenvolvimento: @vercel/routing-utils
6.6.1 usa path-to-regexp 6.1.0 (GHSA-9wv6-86v2-598j) e alias
path-to-regexp-updated 6.3.0. Não concluir que devDependency é necessariamente
ausente do artefato implantado sem inspecionar o bundle.
Outros apontamentos: minimatch/GHSA-g3hv-75wg-m249 e @vercel/queue,
glob/GHSA-3g3m-2fjr-6pw4 e rimraf/google-gax, qs/GHSA-6pq8-jhm2-2vcw,
fast-xml-parser/GHSA-474x-hrwr-fgx4, Vite dev/GHSA-8g5g-mxqh-grgj.
Contagens incluem dependências afetadas transitivamente, não dez
explorações independentes. A auditoria não demonstra alcançabilidade.
Commit 5db1614 adiciona candidato descartável de override estritamente
aninhado @vercel/routing-utils -> path-to-regexp 6.3.0, gera diff com npm,
instala e testa rotas/TypeScript, reaudita e publica proposta como artefato.
Não altera package.json/package-lock.json do repositório, não executa
audit fix --force e não faz deploy. Aguardar relatório para decidir adoção;
revisar diff e compatibilidade antes de aplicar. Demais apontamentos
moderados/baixos requerem análise individual, não downgrade automático.
Sem liberação comercial ou alteração no Firebase principal/tags.


## Correção pontual de segurança aprovada em candidato
Workflow 45530293473, job 138923621533, artefato 14984232170:
80/80 testes de rotas, lint TypeScript aprovado; auditoria completa do
candidato com 0 altas, 0 críticas, 7 moderadas e 1 baixa. A correção
é override aninhado @vercel/routing-utils -> path-to-regexp 6.3.0,
sem downgrade do pacote pai. Revisão do diff gerado pelo npm: além da
versão/resolved/integrity do pacote afetado, ajustes de flags dev/devOptional
e ordenação do lockfile; não houve outras mudanças de versão no diff.
Commit atômico 9389713 aplica os dois blobs exatos do candidato
(package.json 2ec258c60499b52ac2d486a4e2824e6b1c5848ee,
package-lock.json b89f3422e769f12a421298773edb70492c81f94e),
com CI adaptado para aceitar o override já aprovado e rejeitar conflito.
Nova execução integral pendente. Ainda não é correção implantada.
Não confundir ausência de apontamentos altos no npm audit com prova
de segurança completa. Permanecem as ocorrências moderadas/baixa e
a verificação do artefato implantado, sem expansão do escopo.


## Confirmação do pacote corrigido e remediações compatíveis
Na revisão 9389713, workflow 45530582159, job 138924574555, o inventário
do lockfile efetivamente registrado confirma root completo: 0 críticas,
0 altas, 7 moderadas, 1 baixa; root produção: 0 críticas, 0 altas,
6 moderadas, 1 baixa. Workflow de inventário aprovado; os quatro workflows
gerais ainda em execução na consulta. O código não foi implantado.
Commit 840816c acrescenta uma avaliação descartável de npm audit fix
--package-lock-only --ignore-scripts --no-fund, sem --force. A proposta
não pode alterar package.json, dependências de Functions, versão de
@vercel/queue ou versão principal das dependências diretas. Exige auditorias
válidas antes/depois, ausência de novas ocorrências e de altas/críticas,
e prebuild completo, bundle, normalização e lint. Exporta arquivos exatos,
diff, versões alteradas, relatórios e logs para revisão. Não confundir
uma proposta aprovada com atualização aplicada. O resultado ainda está
pendente; manter o lockfile vigente até examinar o diff.
O npm sugere downgrade de @vercel/queue 0.5.1 para 0.1.1 devido à cadeia
minimatch. Não aceitar automaticamente: preservar contratos da integração.
Caso remanesça, analisar atualização específica compatível e uso real
de padrões glob, sem alterar o contrato da fila por conveniência.
Não habilitar infraestrutura nem estender o escopo comercial por este CI.
