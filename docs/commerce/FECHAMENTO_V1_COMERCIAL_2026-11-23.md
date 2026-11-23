# Kyrub · Fechamento da V1 comercial
23 de novembro de 2026 · Parecer para revisão do proprietário

**Decisão proposta: manter aberta a homologação comercial.** O aplicativo está publicado. A cadeia de varejo passou em isolamento e há registros históricos de pagamentos reais. Ainda falta uma venda rastreável da versão auditada até o ERP, com reconciliação financeira e tratamento de exceções. Há uma obrigação histórica que merece acompanhamento próprio. O piloto de assinatura e a operação remunerada de entregas têm critérios adicionais.

## Base da decisão

- **Versão publicada.** A [main em e4bc530](https://github.com/kyrub-app/kyrub/commit/e4bc5301108f087693ce3a94dafbc4104fdb2fd2) coincide com o [deployment de produção READY](https://vercel.com/kyrubapp-6434s-projects/kyrub/4shPMeo4R4XQozmaYiZ9EHMryeo3). Os aliases www.kyrub.com, admin.kyrub.com e planos.kyrub.com apontam para ele. kyrub.com aponta para o mesmo deployment e redireciona com 308 para www. A confirmação cobre a versão do aplicativo. A consulta pública desta auditoria a health e à vitrine não retornou conteúdo verificável. Disponibilidade funcional, configuração de flags, revisão de Rules, índices e Functions ativos exigem evidência própria.
- **Cobertura histórica.** O intervalo inclui 120 PRs, das quais 111 integradas à main e 9 abertas, mais a issue #1201. O apêndice identifica cada número. Estado e merge vieram dos metadados do GitHub, inclusive quando a descrição ainda dizia “Draft” após o merge.
- **Execução dos testes.** Consultei resultados existentes e código fixado no SHA. Nenhuma nova sessão de comprador, transação ou suíte foi executada para este parecer. No SHA de merge a consulta de workflows retornou zero registros. As evidências verdes abaixo pertencem aos HEADs das PRs.
- **Referências de planejamento.** A [lista-mãe](https://github.com/kyrub-app/kyrub/blob/e4bc5301108f087693ce3a94dafbc4104fdb2fd2/ROADMAP_PROXIMOS_AJUSTES.md) conserva os itens 1–67 e a extensão 68. O painel de prioridades da [#1148](https://github.com/kyrub-app/kyrub/pull/1148) continua em rascunho. A sua fotografia de produção de 17/11 foi superada pela #1268. A [visão de longo prazo](https://github.com/kyrub-app/kyrub/blob/e4bc5301108f087693ce3a94dafbc4104fdb2fd2/docs/ROADMAP_MASTER.md) permanece referência para expansões.

## Matriz de pendências e critérios de aceite

“Publicado” refere-se ao código presente na versão acima. “Isolado” identifica evidência em teste, emulador ou preview. “Histórico real” registra observação documentada em PR. “Sem prova atual” mantém em aberto o comportamento ou desfecho individual.

| Jornada e impacto | Evidência e estado no corte | Pendência e resultado exigido para encerrar |
|---|---|---|
| Criar loja Free · núcleo | Comando autenticado publicado. O provisionador grava e reutiliza o marcador canônico, preserva plano pago e devolve o plano efetivo. O texto inicial do runbook dizendo que falta ligar a ativação ficou obsoleto. Teste de primeira loja idempotente no emulador. [Comando](https://github.com/kyrub-app/kyrub/blob/e4bc5301108f087693ce3a94dafbc4104fdb2fd2/api/plan-control.ts) · [Serviço](https://github.com/kyrub-app/kyrub/blob/e4bc5301108f087693ce3a94dafbc4104fdb2fd2/server/actions/freeStoreProvisioningService.ts) · [Teste](https://github.com/kyrub-app/kyrub/blob/e4bc5301108f087693ce3a94dafbc4104fdb2fd2/tests/firestore-official-plan-pix.test.ts) | Em conta controlada, clicar, repetir e relogar. Conferir uma identidade canônica, mesma data, ERP acessível e vitrine ainda privada. Verificar 5 produtos, tentativa do sexto e aplicação do limite mensal de R$ 5.000 na fronteira. Para conta paga, verificar preservação das datas. |
| Catálogo e publicação · núcleo | #1149–#1153 integraram catálogo, personalização, carrinho e listagem. #1188–#1189, #1258–#1261 e #1265 cobrem descoberta, vitrine, banners, galeria, políticas e horários. Workflow de mídia pública verde na #1268. | Lojista salva produto com variação e estoque, publica, edita e pausa. Visitante vê preço, mídia, políticas e disponibilidade corretos. Item retirado do carrinho deve exigir reconciliação. Publicar ou pausar preserva vigência. Registrar ID canônico e slug correlacionados. |
| Pedido varejista, KDS e ERP · núcleo | Fluxo checkout simulado, estoque, recusa e restauração já passou nas candidatas #1152/#1153. #1240 integra aceite e modalidade em transação, #1241 trata legado sem estoque. #1250–#1256 integram PDV e quatro módulos do staff. | Na mesma venda, correlacionar pedido de comprador, fila do lojista, modalidade, KDS e movimento de estoque. Repetir evento sem segunda baixa. Em pedido separado, recusar e conferir restauração quando aplicável. Android e desktop, inclusive falha de persistência. Entregador próprio deve manter a corrida fora do mural Kyrub. |
| Checkout varejista e Mercado Pago · bloqueio financeiro do núcleo | #1228 preserva a credencial do lojista em webhook pendente. #1229–#1237 acrescentam diagnóstico, conciliação e recorte histórico. #1236 documenta dois pagamentos aprovados e obrigação aberta à época. A [rota de intenção](https://github.com/kyrub-app/kyrub/blob/e4bc5301108f087693ce3a94dafbc4104fdb2fd2/server/payments/paymentIntentRouter.ts) integra o checkout. | Em sandbox, parear loja, recebedor, moeda, valor e referência com intenção, pedido e razão. Cobrir pendente, rejeitado, expirado, aprovado e reentrega concorrente. Uma cobrança, um efeito. Divergências retêm liberação. Validar OAuth da loja e conciliação de eventos atrasados. O X-Burger real do item 11 exige produto legítimo e autorização própria. |
| Planos oficiais · bloqueio da oferta paga | #1159, #1168–#1169 e #1257 publicaram cotação, aceite e caminho para a Loja Oficial. Pro R$ 197, Business R$ 397, pré-pagos. O [checkout](https://github.com/kyrub-app/kyrub/blob/e4bc5301108f087693ce3a94dafbc4104fdb2fd2/server/payments/officialPlanPixCheckout.ts) restringe o caso sem loja ao emulador ou ao piloto explicitamente habilitado para comprador autorizado. Há prova isolada de concorrência. | Exercitar Pro e Business com/sem loja, períodos 1/3/6/12 meses, descontos 0/20/30/40%, data de aprovação como início, criação tardia sem reinício, zero renovação e rejeição no carrinho genérico. Confirmar catálogo canônico, recebedor oficial 3631706959, webhook, flags e single-use via preflight autorizado. O piloto escolhido é Business mensal R$ 397 menos R$ 396 = R$ 1, comprador único, sem prêmio. Exige decisão separada para cobrar. [Runbook](https://github.com/kyrub-app/kyrub/blob/e4bc5301108f087693ce3a94dafbc4104fdb2fd2/docs/OFFICIAL_PLAN_PIX_RELEASE.md) |
| Reembolsos e compensação · bloqueio financeiro do núcleo | #1244–#1249 separam diagnóstico, tentativa falha, observação do provedor e consulta voluntária. Para o caso histórico de R$ 23,30, o registro relata pagamento aprovado, tentativa parcial falha e R$ 0 devolvidos na consulta. A #1249 corrige o vínculo entre loja canônica e vitrine. | Confirmar por leitura autorizada o estado atual da obrigação e o destinatário da proposta. Em sandbox, validar integral, parcial, concorrência e estado incerto. Somente confirmação do PSP sustenta baixa no razão. Obter recibo ou manter pendência identificada com responsável e prazo. Interesse em crédito, inclusive com bônus, não quita a obrigação. |
| Notificações · núcleo nos eventos comerciais prometidos | #1178 organiza a caixa. #1242/#1249 cobrem consulta de compensação e #1253–#1256 geram eventos de staff. As três rotas de inbox/chat/preferências constam em [vercel.json](https://github.com/kyrub-app/kyrub/blob/e4bc5301108f087693ce3a94dafbc4104fdb2fd2/vercel.json). Os serviços de convites de notas e DM da #1243 estão ausentes nos respectivos caminhos da main. | Montar quadro produtor → destinatário → abertura para pedido, recusa, compensação, chat da loja e staff. Validar dois perfis, link correto, isolamento por loja, retry e uma notificação. Para notas e DM, reconciliar apenas o delta da #1243. Verificar polling com app aberto. Push em segundo plano só integra o aceite se ofertado. |
| Segurança e release · bloqueio transversal | Correção de dependências da #1150 já incorporada nas #1149/#1151. CI de Rules e Phase 10 passou na #1268. [Rules](https://github.com/kyrub-app/kyrub/blob/e4bc5301108f087693ce3a94dafbc4104fdb2fd2/firestore.rules) e [índices](https://github.com/kyrub-app/kyrub/blob/e4bc5301108f087693ce3a94dafbc4104fdb2fd2/firestore.indexes.json) existem na main. A revisão instalada em produção ficou sem comprovação. | Registrar revisão efetiva de Rules, índices, Functions e backend no projeto correto. Em ambiente isolado provar acesso por papel e tenant, negação entre lojas, proteção de anexos POP, idempotência, logs sanitizados e assinatura dos callbacks. Registrar responsáveis, alertas e rollback separado de app e regras, preservando ledger e histórico. |
| Gamificação inicial · bloqueio da emissão | #1153, #1184, #1195 e #1216 integram carteira, jornada e catálogo de desafios. Semear grava progressão não econômica. O [inventário de escritores implantados](https://github.com/kyrub-app/kyrub/blob/e4bc5301108f087693ce3a94dafbc4104fdb2fd2/docs/PITANGA_WRITER_DEPLOYMENT_EVIDENCE.md) exige atestação inclusive fora do repo. Testes isolados de welcome e publicação estão registrados. | Comprovar todos os escritores e bloqueio transacional por versão. No ambiente isolado: 100 Pitangas uma vez no primeiro login, 2 XP uma vez na primeira publicação, zero por simplesmente criar a loja, conversão voluntária 1.000:1 e saldo/recibo coerentes sob retry. Exigir prova e autorização da emissão antes de anunciar benefício ativo. |
| Entregas Kyrub remuneradas · bloqueios técnico, operacional e externo | #1154 contém homologação isolada de privacidade/retorno. #1238 está aberta. Na [main](https://github.com/kyrub-app/kyrub/blob/e4bc5301108f087693ce3a94dafbc4104fdb2fd2/src/components/modals/DeliveryManagerModal.tsx), handleAcceptDelivery ainda dá sucesso e muda o estado local sem aguardar o servidor. O aceite de pedido do lojista na #1240 é outro evento. | Reconciliar o delta da #1238. Dois entregadores disputam uma corrida: somente um aceite confirmado, identidade e documentos válidos. Falha mantém a oferta sem aceite. Validar GPS físico, coleta, destino privado, entrega, ausência, retorno autorizado, espera e suporte auditado. Obter do PSP evidência da proteção/liquidação do frete 1:N e conciliar obrigação por participante. Nenhum repasse manual presumido. |

## Ordem executiva de encerramento

| Ordem e responsável proposto | Entrega verificável | Decisão que libera |
|---|---|---|
| 1 · Engenharia e operação | Fixar o SHA auditado e anexar inventário de configurações efetivas por ambiente, revisão de regras e índices, CI por SHA, responsáveis e plano de reversão. Abrir lista de divergências concretas. | Iniciar ensaio controlado com dados sintéticos e contas de papéis distintos. |
| 2 · QA e lojista de homologação | Um roteiro contínuo em Android e navegador: criar Free → cadastrar → publicar → comprar → acompanhar pedido → aceitar no KDS → conferir estoque/ERP e sininho. Anexar correlação sanitizada entre telas e registros, inclusive ao relogar. | Aceite do núcleo operacional pelo proprietário. Corrigir apenas a transição que falhar. |
| 3 · Financeiro e engenharia | Dois dossiês independentes em sandbox: varejo com recusa/reembolso e planos com aprovação e vigência. Anexar respostas sanitizadas, referências correlacionadas, valor, timestamps, ledger e retries. Dar destino operacional à pendência histórica de R$ 23,30. | Submeter separadamente os pilotos reais aplicáveis, com comprador/recebedor, limite, janela e reconciliação. |
| 4 · Segurança e produto | Confirmar o que o público consegue contratar e quais benefícios o aplicativo promete. Registrar prova de cada promessa ativa. Atacar deltas de notificações e atestação de escritores em paralelo à homologação financeira. | Aceitar somente a oferta verificada. Se as campanhas integrarem a promessa de lançamento, a emissão bloqueia esse aceite. |
| 5 · Logística e responsável comercial | Dossiê GPS em aparelho, exclusividade, custódia, retorno, suporte e parecer do PSP. Registrar diferenças entre retirada, entrega própria e corrida Kyrub. | Aceite próprio para entrega remunerada. Retirada e entrega própria podem ser avaliadas no núcleo. |
| 6 · Proprietário e responsáveis pelas áreas | Registrar por jornada PASS, FALHOU ou BLOQUEADA, SHA, ambiente, data, atores, evidência, responsável e prazo. Reunir autorizações específicas e evidência pós-operação quando cabível. | Declarar V1 apenas com núcleo aprovado e oferta pública compatível com o escopo assinado. A oferta completa exige também os aceites condicionais correspondentes. |

## Reconciliação da lista-mãe e das PRs sobrepostas

| Itens da lista | Tratamento nesta revisão |
|---|---|
| 1–3 e 63–67 | SHA e aliases conferidos. Fechar verificação funcional, segurança, documentação e aceite conjunto com os dossiês acima. |
| 4–14 | Manter credenciais, webhook, autoridade e gates já construídos. Faltam provas de ambiente, falhas, reconciliação e refund. Preservar autorização individual para dinheiro real. |
| 15–21 | Distinguir recebimento pelo lojista, eventual comissão 1:1 e liquidação 1:N do entregador. #1228 trata credencial e webhook. Nenhum comprovante desta auditoria encerra a qualificação comercial do PSP. |
| 22–30 | Preservar importação, conexões externas, proveniência e sincronização para expansão. Isolamento por tenant continua obrigatório no núcleo. |
| 31–54 | Carteira, desafio inicial e integridade dos escritores entram no aceite da gamificação prometida. Clubes locais, resgates, patrocínios, campanhas avançadas e assistentes permanecem na fila histórica. |
| 55–62 | Conferir termos, consentimento e governança aplicáveis à oferta real com o responsável humano. Manter agentes e automações futuras na lista. |
| Extensão 68 | Frente Kyrub Tag independente, fora da intervenção deste relatório. |

A #1148 deve aproveitar esta fotografia na próxima revisão. A #1150 foi absorvida pela cadeia #1149/#1151, e o trabalho de moderação da #1155 reaparece nas #1156–#1158. A navegação da #1167 deve ser comparada com #1183/#1188–#1190. A reprodução da #1202 permanece material diagnóstico da issue #1201, com correções posteriores #1207–#1209. A #1221 pertence à frente independente de dispositivos. Para #1154, #1238 e #1243, comparar os caminhos efetivos e portar apenas lacunas confirmadas. Nenhuma dessas recomendações encerra ou integra uma PR.

## Evidências de CI consultadas

| PR e HEAD | Execuções concluídas com sucesso na consulta |
|---|---|
| #1159 · [87ffa7f6](https://github.com/kyrub-app/kyrub/commit/87ffa7f65364b4c993ef252ac65b7f5a90e18aa6) | 13/13 · [Firebase key attestation](https://github.com/kyrub-app/kyrub/actions/runs/44334715810) · [First store publication browser preflight](https://github.com/kyrub-app/kyrub/actions/runs/44334715878) · [Phase 10 integrated validation](https://github.com/kyrub-app/kyrub/actions/runs/44334716343) · [First store publication Auth Emulator HTTP](https://github.com/kyrub-app/kyrub/actions/runs/44334716038) · [First store publication Playwright smoke](https://github.com/kyrub-app/kyrub/actions/runs/44334715823) · [Application build](https://github.com/kyrub-app/kyrub/actions/runs/44334715829) · [Welcome 100 Pitangas isolated contracts](https://github.com/kyrub-app/kyrub/actions/runs/44334716058) · [Official plan + gamification cross-PR isolated E2E](https://github.com/kyrub-app/kyrub/actions/runs/44334716124) · [Identity security rules](https://github.com/kyrub-app/kyrub/actions/runs/44334715897) · [Official plan canonical Firestore E2E](https://github.com/kyrub-app/kyrub/actions/runs/44334715869) · [Validate Kyrub](https://github.com/kyrub-app/kyrub/actions/runs/44334715992) · [Store security rules](https://github.com/kyrub-app/kyrub/actions/runs/44334716129) · [Official plan Praça Chromium E2E](https://github.com/kyrub-app/kyrub/actions/runs/44334715884) |
| #1249 · [dcf9ad43](https://github.com/kyrub-app/kyrub/commit/dcf9ad4339b54b2c41638cf3ffdc9cdfb3b9b008) | 5/5 · [Phase 10 integrated validation](https://github.com/kyrub-app/kyrub/actions/runs/45072828746) · [Application build](https://github.com/kyrub-app/kyrub/actions/runs/45072828701) · [Official plan Praça Chromium E2E](https://github.com/kyrub-app/kyrub/actions/runs/45072828705) · [Store security rules](https://github.com/kyrub-app/kyrub/actions/runs/45072828769) · [Validate Kyrub](https://github.com/kyrub-app/kyrub/actions/runs/45072828792) |
| #1256 · [d4096b7b](https://github.com/kyrub-app/kyrub/commit/d4096b7b5083457351170c0dd0e586c54c757324) | 14/14 · [First store publication browser preflight](https://github.com/kyrub-app/kyrub/actions/runs/45105413911) · [Staff tasks Firestore E2E](https://github.com/kyrub-app/kyrub/actions/runs/45105413878) · [Staff shifts Firestore E2E](https://github.com/kyrub-app/kyrub/actions/runs/45105413969) · [Identity security rules](https://github.com/kyrub-app/kyrub/actions/runs/45105413879) · [Staff notices Firestore E2E](https://github.com/kyrub-app/kyrub/actions/runs/45105414036) · [First store publication Playwright smoke](https://github.com/kyrub-app/kyrub/actions/runs/45105413897) · [First store publication Auth Emulator HTTP](https://github.com/kyrub-app/kyrub/actions/runs/45105413853) · [Staff POPs Firestore and Storage E2E](https://github.com/kyrub-app/kyrub/actions/runs/45105413795) · [Application build](https://github.com/kyrub-app/kyrub/actions/runs/45105413861) · [Official plan canonical Firestore E2E](https://github.com/kyrub-app/kyrub/actions/runs/45105414121) · [Phase 10 integrated validation](https://github.com/kyrub-app/kyrub/actions/runs/45105413883) · [Welcome 100 Pitangas isolated contracts](https://github.com/kyrub-app/kyrub/actions/runs/45105414105) · [Store security rules](https://github.com/kyrub-app/kyrub/actions/runs/45105413793) · [Validate Kyrub](https://github.com/kyrub-app/kyrub/actions/runs/45105413934) |
| #1268 · [db56cc8f](https://github.com/kyrub-app/kyrub/commit/db56cc8fded29cc5bb0057be5015b6c5f82ef4ca) | 6/6 · [Store public media manager Firestore E2E](https://github.com/kyrub-app/kyrub/actions/runs/45231081483) · [Phase 10 integrated validation](https://github.com/kyrub-app/kyrub/actions/runs/45231081469) · [Validate Kyrub](https://github.com/kyrub-app/kyrub/actions/runs/45231082157) · [Official plan Praça Chromium E2E](https://github.com/kyrub-app/kyrub/actions/runs/45231081466) · [Application build](https://github.com/kyrub-app/kyrub/actions/runs/45231081450) · [Store security rules](https://github.com/kyrub-app/kyrub/actions/runs/45231081448) |

## Apêndice · cobertura de #1148 a #1268

O estado desta tabela é de integração do código. A matriz acima identifica onde há prova funcional adicional.

| Número | Estado | Assunto registrado no GitHub |
|---|---|---|
| [#1148](https://github.com/kyrub-app/kyrub/pull/1148) | Rascunho aberto | docs(roadmap): priorizar V1 comercial confiável sem perder lista-mãe de 67 itens |
| [#1149](https://github.com/kyrub-app/kyrub/pull/1149) | Integrada | test(v1): candidato integrado ERP/Marketplace #1139 + proteção de reembolsos #1146 |
| [#1150](https://github.com/kyrub-app/kyrub/pull/1150) | Rascunho aberto | fix(security): isolate Vite/build tooling from production dependency graph |
| [#1151](https://github.com/kyrub-app/kyrub/pull/1151) | Integrada | test(v1): integrate ERP, refunds and official plan promotions in one candidate |
| [#1152](https://github.com/kyrub-app/kyrub/pull/1152) | Integrada | test(v1): combine commerce and public Praça/Communities/Kyrubia education |
| [#1153](https://github.com/kyrub-app/kyrub/pull/1153) | Integrada | test(v1): reconcile commerce, social and fenced gamification contracts |
| [#1154](https://github.com/kyrub-app/kyrub/pull/1154) | Rascunho aberto | test(v1-entregas): reconcile privacy-safe courier and return flows without real settlement |
| [#1155](https://github.com/kyrub-app/kyrub/pull/1155) | Rascunho aberto | fix(social): authenticated reports, Praça actions and human moderation queue |
| [#1156](https://github.com/kyrub-app/kyrub/pull/1156) | Integrada | test(v1): join social moderation trust with commercial candidate |
| [#1157](https://github.com/kyrub-app/kyrub/pull/1157) | Integrada | feat(v1): avaliações canônicas de loja vinculadas à Praça e curtidas |
| [#1158](https://github.com/kyrub-app/kyrub/pull/1158) | Integrada | feat(v1): denúncias e moderação auditada de avaliações somente na loja |
| [#1159](https://github.com/kyrub-app/kyrub/pull/1159) | Integrada | feat(v1): piloto Business R$1 via cupom exclusivo e Pix real protegido (sem ativar) |
| [#1160](https://github.com/kyrub-app/kyrub/pull/1160) | Integrada | fix(entry): abrir painel completo do Kyrub na raiz sem exigir login para explorar |
| [#1161](https://github.com/kyrub-app/kyrub/pull/1161) | Integrada | fix(frontend): perfil no primeiro ícone e sair da conta dentro do perfil |
| [#1162](https://github.com/kyrub-app/kyrub/pull/1162) | Integrada | feat(frontend): Jemboé/Catu/Taba na navegação e Cairúbia no cabeçalho |
| [#1163](https://github.com/kyrub-app/kyrub/pull/1163) | Integrada | fix(frontend): remover blocos introdutórios da guia Jemboé |
| [#1164](https://github.com/kyrub-app/kyrub/pull/1164) | Integrada | fix(frontend): Lojas acima de Comunidades na Taba, sem importação de testes |
| [#1165](https://github.com/kyrub-app/kyrub/pull/1165) | Integrada | fix(frontend): remover ícone redundante Marketplace do cabeçalho |
| [#1166](https://github.com/kyrub-app/kyrub/pull/1166) | Integrada | feat(Cairúbia): apresentação de assistente pessoal no lugar da Educadora |
| [#1167](https://github.com/kyrub-app/kyrub/pull/1167) | Rascunho aberto | fix(praca): simplificar navegação de Lojas e Comunidades |
| [#1168](https://github.com/kyrub-app/kyrub/pull/1168) | Integrada | fix: eliminar seleção duplicada de planos na vitrine oficial |
| [#1169](https://github.com/kyrub-app/kyrub/pull/1169) | Integrada | fix: tornar revisão do checkout oficial clara e diagnosticar falhas de cotação |
| [#1170](https://github.com/kyrub-app/kyrub/pull/1170) | Integrada | fix: restaurar saída da conta no perfil e adicionar Pitangas ao cabeçalho |
| [#1171](https://github.com/kyrub-app/kyrub/pull/1171) | Integrada | fix: exibir logout no cabeçalho do painel pessoal, sem abrir edição |
| [#1172](https://github.com/kyrub-app/kyrub/pull/1172) | Integrada | fix: simplificar comunidade, anexar fotos/vídeos ao mural e ampliar textos |
| [#1173](https://github.com/kyrub-app/kyrub/pull/1173) | Integrada | fix(Comunidades): rolagem integral e botão voltar ao topo |
| [#1174](https://github.com/kyrub-app/kyrub/pull/1174) | Integrada | feat(Comunidades): curtir, comentar, conectar, conversar, ver perfil e denunciar |
| [#1175](https://github.com/kyrub-app/kyrub/pull/1175) | Integrada | Praça: distribuição orgânica de publicações das comunidades públicas por 24h |
| [#1176](https://github.com/kyrub-app/kyrub/pull/1176) | Integrada | Corrigir edição da comunidade e separar editor de perfil pessoal |
| [#1177](https://github.com/kyrub-app/kyrub/pull/1177) | Integrada | Comunidades: Encaminhar para Praça por 24h e para Kairubidos conectados |
| [#1178](https://github.com/kyrub-app/kyrub/pull/1178) | Integrada | Notificações: abas por origem e limite de encaminhamento por destinatário |
| [#1179](https://github.com/kyrub-app/kyrub/pull/1179) | Integrada | Corrigir erro de permissões ao Participar das Comunidades |
| [#1180](https://github.com/kyrub-app/kyrub/pull/1180) | Integrada | Simplificar Comunidades: remover Debates e manter conversas no Mural |
| [#1181](https://github.com/kyrub-app/kyrub/pull/1181) | Integrada | feat(social): respostas encadeadas nos comentários de Comunidades, Praça e perfil |
| [#1182](https://github.com/kyrub-app/kyrub/pull/1182) | Integrada | fix(Comunidades): preservar vínculo das respostas no card da Praça |
| [#1183](https://github.com/kyrub-app/kyrub/pull/1183) | Integrada | feat(Praça): catálogo de comunidades e filtros Participante/Favoritos em ambas as vitrines |
| [#1184](https://github.com/kyrub-app/kyrub/pull/1184) | Integrada | feat(gamificação): Semear nas publicações e Jornada da Pitangueira com limite por post |
| [#1185](https://github.com/kyrub-app/kyrub/pull/1185) | Integrada | fix(Praça): reconhecer conexões aceitas em publicações e usar semente no Semear |
| [#1186](https://github.com/kyrub-app/kyrub/pull/1186) | Integrada | feat(identidade): novo selo da pitanga e tema verde-noite em todos os painéis |
| [#1187](https://github.com/kyrub-app/kyrub/pull/1187) | Integrada | fix(sessão): Entrar/Sair junto ao logo Kyrub, sem logout duplicado no perfil |
| [#1188](https://github.com/kyrub-app/kyrub/pull/1188) | Integrada | feat(Praça): padronizar catálogos de lojas/comunidades com cabeçalho fixo |
| [#1189](https://github.com/kyrub-app/kyrub/pull/1189) | Integrada | fix(Praça): restaurar Avaliações e Entrar nos cards do catálogo de lojas |
| [#1190](https://github.com/kyrub-app/kyrub/pull/1190) | Integrada | style(Praça): botões sem ícones, cards duplos e tipografia maior |
| [#1191](https://github.com/kyrub-app/kyrub/pull/1191) | Integrada | feat(Perfil): Central Pessoal com Carteira, planejamento manual e atalhos globais |
| [#1192](https://github.com/kyrub-app/kyrub/pull/1192) | Integrada | fix(Perfil): editor único e controle de visibilidade na Central Pessoal |
| [#1193](https://github.com/kyrub-app/kyrub/pull/1193) | Integrada | fix(Perfil): consolidar os três editores em um único painel |
| [#1194](https://github.com/kyrub-app/kyrub/pull/1194) | Integrada | refactor(Central): engrenagem de edição e visibilidade no selo do perfil |
| [#1195](https://github.com/kyrub-app/kyrub/pull/1195) | Integrada | refactor(Carteira): unificar Pitangas e XP e adicionar cocar à Jornada |
| [#1196](https://github.com/kyrub-app/kyrub/pull/1196) | Integrada | refactor(Central): engrenagem sobre o avatar e ícone único de entrar/sair |
| [#1197](https://github.com/kyrub-app/kyrub/pull/1197) | Integrada | fix(Navegação): login/logout na marca rolável e apenas ícones fixos |
| [#1198](https://github.com/kyrub-app/kyrub/pull/1198) | Integrada | fix(Praça): restaurar Lojas, Comunidades e Mural para visitantes |
| [#1199](https://github.com/kyrub-app/kyrub/pull/1199) | Integrada | fix(Navegação/Praça): cabeçalho único e reconciliação de comunidades públicas |
| [#1200](https://github.com/kyrub-app/kyrub/pull/1200) | Integrada | fix(Praça): mostrar comunidades públicas no catálogo autenticado mesmo sem leitura privada |
| [#1201](https://github.com/kyrub-app/kyrub/issues/1201) | Issue aberta | Leitura de comunidade pública no catálogo autenticado |
| [#1202](https://github.com/kyrub-app/kyrub/pull/1202) | Aberta | test(Comunidades): reproduzir leitura de comunidades antigas no Firebase Emulator (#1201) |
| [#1203](https://github.com/kyrub-app/kyrub/pull/1203) | Integrada | diag(Comunidades): verificar consulta, cache e leitura direta no aparelho autenticado (#1201) |
| [#1204](https://github.com/kyrub-app/kyrub/pull/1204) | Integrada | diag(Comunidades): conferir projeto e banco Firestore usados no aparelho (#1201) |
| [#1205](https://github.com/kyrub-app/kyrub/pull/1205) | Integrada | diag(Comunidades): comparar SDK Firebase e REST Google com a mesma sessão (#1201) |
| [#1206](https://github.com/kyrub-app/kyrub/pull/1206) | Integrada | diag(Comunidades): comparar Firestore Lite e metadados de sincronização (#1201) |
| [#1207](https://github.com/kyrub-app/kyrub/pull/1207) | Integrada | fix(Comunidades): recuperar leitura pública autenticada pelo Firestore Lite (#1201) |
| [#1208](https://github.com/kyrub-app/kyrub/pull/1208) | Integrada | fix(Comunidades): manter criações futuras acessíveis após salvar e relogar |
| [#1209](https://github.com/kyrub-app/kyrub/pull/1209) | Integrada | feat(Praça): rolagem infinita por cursor no catálogo de Comunidades |
| [#1210](https://github.com/kyrub-app/kyrub/pull/1210) | Integrada | fix(Praça): rolar cabeçalho e filtros com os cards em Comunidades e Lojas |
| [#1211](https://github.com/kyrub-app/kyrub/pull/1211) | Integrada | fix(UI): padronizar tipografia dos painéis pela referência Catu/Renda |
| [#1212](https://github.com/kyrub-app/kyrub/pull/1212) | Integrada | fix(UI): auditoria tipográfica transversal de app, ERP e administração |
| [#1213](https://github.com/kyrub-app/kyrub/pull/1213) | Integrada | fix(UI): fontes responsivas e rótulos completos nos catálogos |
| [#1214](https://github.com/kyrub-app/kyrub/pull/1214) | Integrada | fix(UI): impedir zoom cumulativo na Catu e botão Adicionar quebrado na vitrine |
| [#1215](https://github.com/kyrub-app/kyrub/pull/1215) | Integrada | fix(social): atualizar nomes de autores em publicações antigas após renomear perfil |
| [#1216](https://github.com/kyrub-app/kyrub/pull/1216) | Integrada | feat(Central Pessoal): card e painel de Desafios da plataforma com dados reais |
| [#1217](https://github.com/kyrub-app/kyrub/pull/1217) | Integrada | feat(Central Pessoal): Conquistas + Dispositivos com base NFC/LoRa offline |
| [#1218](https://github.com/kyrub-app/kyrub/pull/1218) | Integrada | feat(Dispositivos): Meu smartphone como fase zero do Kairub |
| [#1219](https://github.com/kyrub-app/kyrub/pull/1219) | Integrada | fix(Dispositivos): remover introdução e refletir teste NFC confirmado |
| [#1220](https://github.com/kyrub-app/kyrub/pull/1220) | Integrada | feat(Dispositivos): cartão de visita digital e gravação NFC da vitrine |
| [#1221](https://github.com/kyrub-app/kyrub/pull/1221) | Rascunho aberto | protótipo Android: cartão de visita NFC entre smartphones (HCE Type 4) |
| [#1222](https://github.com/kyrub-app/kyrub/pull/1222) | Integrada | feat(Identidade): contrato de endereços públicos categorizados |
| [#1223](https://github.com/kyrub-app/kyrub/pull/1223) | Integrada | Kyrub Tag: titularidade intransferível e linha comercial |
| [#1224](https://github.com/kyrub-app/kyrub/pull/1224) | Integrada | Kyrub Tag: emissão controlada da primeira unidade experimental |
| [#1225](https://github.com/kyrub-app/kyrub/pull/1225) | Integrada | Kyrub Tag: entrega sem códigos e reserva por conta |
| [#1226](https://github.com/kyrub-app/kyrub/pull/1226) | Integrada | Kyrub Tag: personalização visual e contatos |
| [#1227](https://github.com/kyrub-app/kyrub/pull/1227) | Integrada | Kyrub Tag: reproduzir interface compacta aprovada |
| [#1228](https://github.com/kyrub-app/kyrub/pull/1228) | Integrada | Mercado Pago: preservar credencial do lojista em webhooks pendentes |
| [#1229](https://github.com/kyrub-app/kyrub/pull/1229) | Integrada | Mercado Pago: separar estados e conferir vínculos financeiros |
| [#1230](https://github.com/kyrub-app/kyrub/pull/1230) | Integrada | Diagnóstico de limpeza: referências de pagamento em todos os contextos |
| [#1231](https://github.com/kyrub-app/kyrub/pull/1231) | Integrada | Kyrub Oficial: limpeza controlada de 11 registros de teste |
| [#1232](https://github.com/kyrub-app/kyrub/pull/1232) | Integrada | Mercado Pago: consultar cobranças de teste e esclarecer bloqueios da limpeza |
| [#1233](https://github.com/kyrub-app/kyrub/pull/1233) | Integrada | Kyrub Oficial: detalhar vínculos financeiros e legados antes da limpeza |
| [#1234](https://github.com/kyrub-app/kyrub/pull/1234) | Integrada | Kyrub Oficial: classificar registros financeiros legados na análise de limpeza |
| [#1235](https://github.com/kyrub-app/kyrub/pull/1235) | Integrada | Kyrub Oficial: conciliar pagamentos legados com Mercado Pago antes da limpeza |
| [#1236](https://github.com/kyrub-app/kyrub/pull/1236) | Integrada | Kyrub Oficial: iniciar nova fase sem apagar pagamentos reais |
| [#1237](https://github.com/kyrub-app/kyrub/pull/1237) | Integrada | Kyrub Oficial: corrigir filtro da nova fase e autenticação da recusa |
| [#1238](https://github.com/kyrub-app/kyrub/pull/1238) | Aberta | Kyrub Entregas: confirmar aceite no servidor após aprovação documental |
| [#1239](https://github.com/kyrub-app/kyrub/pull/1239) | Integrada | fix(ERP): remover aviso temporário da nova fase operacional |
| [#1240](https://github.com/kyrub-app/kyrub/pull/1240) | Integrada | fix(KDS): aceite e modalidade de entrega atômicos; recusa e reembolso claros |
| [#1241](https://github.com/kyrub-app/kyrub/pull/1241) | Integrada | fix(ERP): permitir recusa segura de pedido legado pendente sem estoque |
| [#1242](https://github.com/kyrub-app/kyrub/pull/1242) | Integrada | feat(ERP): consulta de crédito compensatório em reais com bônus e sininho (sem emissão) |
| [#1243](https://github.com/kyrub-app/kyrub/pull/1243) | Rascunho aberto | fix: conectar sininho a convites de notas, DMs e rotas Vercel existentes |
| [#1244](https://github.com/kyrub-app/kyrub/pull/1244) | Integrada | fix(ERP): minimizar aviso de reembolso pendente e bloquear valor zerado na confirmação |
| [#1245](https://github.com/kyrub-app/kyrub/pull/1245) | Integrada | fix(ERP): permitir rolagem do diagnóstico de reembolso no celular |
| [#1246](https://github.com/kyrub-app/kyrub/pull/1246) | Integrada | fix(refunds): verificar pagamento e devoluções no Mercado Pago sem movimentar dinheiro |
| [#1247](https://github.com/kyrub-app/kyrub/pull/1247) | Integrada | fix(refunds): registrar evidência auditável da tentativa parcial falha sem reembolsar |
| [#1248](https://github.com/kyrub-app/kyrub/pull/1248) | Integrada | fix(ERP): consulta compensatória após tentativa de reembolso failed auditada |
| [#1249](https://github.com/kyrub-app/kyrub/pull/1249) | Integrada | fix(ERP): vincular proposta de compensação à vitrine pública verificada |
| [#1250](https://github.com/kyrub-app/kyrub/pull/1250) | Integrada | fix(PDV): restaurar abertura de atendimentos presenciais no painel real |
| [#1251](https://github.com/kyrub-app/kyrub/pull/1251) | Integrada | fix(PDV): otimizar cabeçalho e remover filtro Todos duplicado |
| [#1252](https://github.com/kyrub-app/kyrub/pull/1252) | Integrada | feat(ERP): Central do Staff como modal com quatro cards, sem submenu |
| [#1253](https://github.com/kyrub-app/kyrub/pull/1253) | Integrada | feat(staff): primeiro fluxo real de avisos e confirmação de leitura |
| [#1254](https://github.com/kyrub-app/kyrub/pull/1254) | Integrada | feat(staff): Manuais POP versionados, anexos privados e confirmação de leitura |
| [#1255](https://github.com/kyrub-app/kyrub/pull/1255) | Integrada | feat(staff): tarefas atribuídas e checklists auditáveis na Central do Staff |
| [#1256](https://github.com/kyrub-app/kyrub/pull/1256) | Integrada | feat(staff): Escalas de Trabalho com turnos, folgas e conflitos protegidos |
| [#1257](https://github.com/kyrub-app/kyrub/pull/1257) | Integrada | fix(ERP): item Planos abre diretamente a Loja Oficial Kyrub |
| [#1258](https://github.com/kyrub-app/kyrub/pull/1258) | Integrada | feat(storefront): banner imersivo com marca, avaliações e conversa no rodapé |
| [#1259](https://github.com/kyrub-app/kyrub/pull/1259) | Integrada | feat(storefront): acordeão público com Reservas e chave no ERP |
| [#1260](https://github.com/kyrub-app/kyrub/pull/1260) | Integrada | feat(vitrine): 5 banners rotativos, galeria pública e políticas em Informações |
| [#1261](https://github.com/kyrub-app/kyrub/pull/1261) | Integrada | fix(loja): horários responsivos e políticas editáveis no ERP e vitrine |
| [#1262](https://github.com/kyrub-app/kyrub/pull/1262) | Integrada | release(UI): logo aprovado, Momentos e melhorias de comunidades |
| [#1263](https://github.com/kyrub-app/kyrub/pull/1263) | Integrada | fix(communities): exibir imagem de capa completa no cabeçalho |
| [#1264](https://github.com/kyrub-app/kyrub/pull/1264) | Integrada | feat(Praça): capas ocupam todo o card de comunidade e selo no canto superior esquerdo |
| [#1265](https://github.com/kyrub-app/kyrub/pull/1265) | Integrada | feat(Praça): rotacionar fotos do banner das lojas nos cards do marketplace |
| [#1266](https://github.com/kyrub-app/kyrub/pull/1266) | Integrada | fix(Momentos): formulário de publicação primeiro e seção Momentos compartilhados |
| [#1267](https://github.com/kyrub-app/kyrub/pull/1267) | Integrada | feat(Catu): destacar Kyrub Lojas e retirar card Formaliza |
| [#1268](https://github.com/kyrub-app/kyrub/pull/1268) | Integrada | feat(identidade): verde-sálvia na Taba / Praça e laranja consistente na Catu |
