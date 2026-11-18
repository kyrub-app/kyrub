# Gamificação obrigatória para liberar o uso — 15/11/2026

O app já está publicado e possui usuários reais. Esta entrega consolida o código de #1135 (`5a915efd`) sobre main (`5fc6c532`) e conclui a ligação da conversão e do extrato à aplicação. #1136 (`69f1c766`) permanece separada; sua fila foi recuperada e a classificação incorreta de gamificação como pós-lançamento foi corrigida. Não foi repetida a jornada comercial.

## Busca, donos canônicos e implementação

Inspecionados `api/health.ts`, `server/gamification/`, `shared/gamification.ts`, `shared/pitangaXpConversion.ts`, `src/components/tabs/KyrubTab.tsx`, as configurações e os testes da #1135. A publicação da primeira loja já concede 2 XP e zero Pitangas em main. O evento Auth, recibos, transações, guarda dos escritores e conversão 1000:1 da #1135 são reutilizados. Não há nova coleção, economia ou algoritmo de crédito.

Lacuna comprovada: os adaptadores de conversão não tinham rota pública e a tela não oferecia conversão/extrato. `/api/pitangas` usa o multiplexador existente, sem consumir função adicional. GET retorna saldo e extrato de Pitangas/XP em uma leitura transacional; a projeção de saldo deve coincidir com o ledger, caso exista. POST aceita somente requestId e requestedXp. UID deriva do token verificado; relógio, caminhos e escolha de autoridade são do servidor. Reutiliza a transação clean-baseline ou a migração verificada, sem fabricar histórico. O limite é 1000 Pitangas por XP, com débito/XP/recibo atômicos e replay idempotente.

A entrada pública exige adicionalmente projeto real correspondente ao configurado, epoch explícita, status fenced e writersVerified=true dentro da mesma transação. Isso impede que o modo de compatibilidade open/ausente da primitiva isolada seja usado pela nova rota. `KYRUB_PITANGA_XP_CONVERSION_ENABLED` fica desligado por padrão. Nenhuma configuração de produção foi alterada.

A tela substitui as consultas separadas de saldo/XP por uma consulta consistente e inclui extrato e conversão voluntária. Em falha de rede, conserva o requestId para consultar/repetir a mesma conversão. Não inicia uma segunda operação quando o resultado da primeira é desconhecido.

O bônus de 100 Pitangas conserva a elegibilidade da #1135: cadastro Google após o corte configurado, uma concessão por UID, recibo confiável de criação Auth. Não é retroativo nem presume que um novo login de conta antiga seja seu primeiro login. Os 2 XP da primeira publicação permanecem independentes do bloqueio de Pitangas.

Corrigida também a resolução de URLs do teste Playwright preexistente: as mesmas URLs do navegador passam por `new URL(..., location.origin)`, evitando que o TypeScript procure arquivos absolutos do Windows. Não houve mudança na jornada ou nova auditoria comercial.

## Inventário implantado: fatos e alternativas executadas

Consulta somente de leitura em 15/11/2026, 15:32 UTC−3, usando a sessão Firebase existente:

| Fonte | Evidência |
|---|---|
| Functions Gen1 e Gen2 | HTTP 403, SERVICE_DISABLED, cloudfunctions.googleapis.com |
| Cloud Run | HTTP 403, SERVICE_DISABLED, run.googleapis.com |
| Scheduler | HTTP 403, SERVICE_DISABLED, cloudscheduler.googleapis.com |
| Cloud Asset, alternativa ao inventário por serviço | HTTP 403, SERVICE_DISABLED, cloudasset.googleapis.com |
| Pub/Sub topics | HTTP 200, vazio, sem próxima página |
| Cloud Logging, alternativa por histórico de implantação/escrita | HTTP 200, primeira página sem entradas mas com nextPageToken; resultado incompleto, não prova ausência |
| Cloud Monitoring, alternativa por uso de chaves | HTTP 200, duas séries de autenticação por chave de conta de serviço entre 17/08 e 15/11; 4 e 83 pontos diários, sem próxima página |

As métricas comprovam uso de chaves no período; não identificam por si só escritores de Pitangas, nem provam que continuem ativos. Nenhuma chave, token, configuração de serviço ou dado de usuário foi registrado no repositório. A classificação estática da #1135 foi reaproveitada; não é substituta do inventário implantado.

Bloqueio comprovado: as APIs de inventário recusam consulta e a cobertura dos escritores externos continua sem prova. Alternativas concretas: infraestrutura fornece exportação com serviço/revisão/SHA, identidade e destinos de escrita; ou autoriza separadamente habilitar a API Cloud Asset e conceder apenas leitura, complementando-a com o mapeamento das identidades usadas fora do projeto. Para cada identidade com permissão Admin, vincular workload e versão, confirmar que não escreve Pitangas ou comprovar a guarda na transação. Não revogar chaves por suposição e não definir writersVerified apenas porque testes passaram.

## Validação e ativação

Os testes existentes de Auth, recibo, saldo, replay, fence e primeira loja são preservados. Foram acrescentados testes da rota autenticada, da tela em falha de rede e da conversão/extrato pelo adaptador no emulador existente. Resultados locais e CI constam na PR; não presumir sucesso onde não foi observado.

O Java local falhou ao carregar jvm.dll tanto na instalação existente como em JRE portátil oficial. A execução transacional nova está incluída no workflow de emulador da #1135 para validação no CI. Build do cliente e testes unitários/UI passaram localmente; orçamento Vercel permanece 11/12.

Antes de ativar: comprovar escritores/revisões, aprovar o corte e obter autorização explícita para merge, deploy do app/gatilho e configuração dos parâmetros protegidos. Não é necessário repetir cadastro/plano/Pix já aprovados. Nesta entrega: nenhuma alteração de produção, writersVerified, saldos ou credenciais; nenhum merge/deploy. Deploy automático explicitamente desativado para a branch. Rollback: reverter a entrega; interromper futuras conversões/boas-vindas por seus sinalizadores após autorização operacional, sem reescrever saldos nem remover recibos.
