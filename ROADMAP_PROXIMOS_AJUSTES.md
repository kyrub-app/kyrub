# Bateria de Desenvolvimento — Pós AI Team / E2E & Product Expansion

Atualizado em: 2026-08-23

Esta é a bateria oficial de desenvolvimento do Kyrub para a fase de fechamento estrutural do projeto. A numeração e a organização abaixo preservam a lista oficial de 67 pontos definida pelo proprietário.

## Prioridade executiva vigente — V1 comercial confiável (17/11/2026)

> **Esta seção é o painel operacional ativo desta lista-mãe.** Ela reordena a execução sem excluir, renumerar ou dar baixa automática nos 67 itens históricos abaixo. Os status escritos nos itens antigos são fotografias da época: não substituem verificação de `main`, PR, CI e implantação atual. Em conflitos de prioridade, prevalece este painel; em conflitos de regras técnicas/comerciais, revalidar a evidência e obter a decisão apropriada.
>
> **Objetivo imediato:** estabilizar e tornar comercialmente confiável a aplicação **já publicada**, de modo que um novo usuário encontre uma oferta verdadeira, compre com autorização financeira confiável, o lojista receba/processe o pedido e a plataforma concilie cada evento — sem prometer pagamentos/recompensas/entregas não disponíveis. A visão completa do super-app permanece preservada.

### Regra de classificação — usar duas dimensões independentes

- **Prioridade:** `V0` bloqueia segurança de qualquer lançamento; `V1` compõe a primeira versão comercial; `V1-ENTREGAS` é gate para oferecer corridas pagas Kyrub; `V2` é expansão ou funcionalidade que não precisa bloquear o primeiro fluxo comercial *quando não for exposta como pronta*.
- **Estado comprovado:** `PRODUCAO_VERIFICADA` (SHA e fluxo observados no deployment público); `INTEGRADO_MAIN` (sem prova de deployment); `IMPLEMENTADO_PR` (ainda fora da main); `TESTADO_ISOLADO` (emulador/contratos, não uso em produção); `AUDITORIA_PENDENTE`; `OWNER_GATE` (ação/aprovação humana ou comercial); `BLOQUEIO_EXTERNO`; `NAO_INICIADO`.
- Cada tarefa precisa de **referência do código/PR, SHA de validação, resultado de testes, ambiente, dependências, próximo passo e critério de encerramento**. Não marcar `PRODUCAO_VERIFICADA` por CI verde, PR mergeada, teste sintético ou preview antiga.
- Uma funcionalidade pode estar **funcionalmente aprovada em isolamento** e **visualmente pendente**. Este é o caso de entregas da #1145. Isso fecha apenas o bloco funcional, **não o gate de lançamento**.
- Não multiplicar PRs: reconciliar/encerrar drafts antigas substituídas, preservando commits e provas úteis, antes de abrir nova implementação.

### Ordem de execução comercial: um fluxo de ponta a ponta

| Ordem | Bloco de trabalho | PRs/fonte a reconciliar | Pronto quando |
| --- | --- | --- | --- |
| **0 — V0** | **Ambiente, identidade, segurança e autoridade de release**: congelar SHA candidato, conferir `main` x deployment real, Vercel, Firebase Rules, permissões, isolamento de lojas, segredos e logs; planejar lote para não consumir cota. | Itens #1–9, #12, #17, #55, #57–58, #62, #64–67; correção já integrada #1136. | Produção identificada, mudanças candidatas comparadas contra `main`, CI exato e rollback definido; nenhuma operação financeira depende do frontend. |
| **1 — V1** | **Loja + catálogo + pedido**: criar loja Free idempotente sem depender de publicação; preservar plano pago já vigente, não duplicar loja; produto/serviço válido, preço, personalização e estoque consistentes; vitrine, carrinho, aprovação do lojista, espelho canônico, KDS, estoque e CRM. | #1139, contratos já integrados de ativação #1110 e Produtos/Estoque #1136, serviços atuais de pedidos; checar regressões sem duplicá-los. | Um usuário fictício percorre criação/publicação/compra e o lojista opera o mesmo pedido com isolamento, idempotência e estoque correto. |
| **2 — V1** | **Pagamento e pós-venda seguros**: seller OAuth/recebedor autoritativo, Pix marketplace e, separadamente, planos Pro/Business pré-pagos; eventos pendentes/aprovados/rejeitados, retries, webhook, devoluções financeiras, parcial x integral, ledger, reembolso e reconciliação. Cupom oficial usa caminho canônico, nunca carrinho financeiro paralelo. | #1138, #1146, #1147; itens #10–15, #17–18; preflight de conta oficial já desenvolvido. | Testes isolados completos e, **somente após autorização explícita**, piloto Pix real restrito, valor/recebedor exatos, notificação confirmada, nenhum pagamento ou benefício duplicado, falhas recuperáveis. #1146 deve ser revisada antes de liberar reembolso integral. |
| **3 — V1** | **Praça, apresentação e gamificação inicial segura**: oferta/cupom divulgado sem vazamento de audiência, Comunidades sem mistura de dados, 100 Pitangas no primeiro login elegível, 2 XP no primeiro evento de publicação validado e conversão voluntária 1.000 Pitangas → 1 XP, extrato auditável, guardas antifraude/budgets mínimos. Kyrubia Educadora usa interface existente. | #1144 consolida #1140/#1142/#1143; #1137 consolida boa parte de #1135/#1128; desafio da #1134 já integrado; itens #31–37, #53–54. | UI/contratos testados; **atestação dos escritores Firebase da #1137** e proteção de ledger comprovadas antes de ativar recompensas reais. Sem campanhas ou bônus reais enquanto o gate estiver aberto. |
| **4 — V1-ENTREGAS** | **Entrega Kyrub operacional e remuneração protegida**: aceite servidor, GPS, coleta, suporte, ausência, devolução, reatribuição, recebimento físico e reconciliação, mais rail financeiro que reserve/proteja efetivamente o frete e pague o entregador sem saldo livre do lojista. | #1145, #1147, itens #16, #18–21, auditoria financeira e retorno formal Mercado Pago. | #1145 tem homologação **funcional isolada** no commit `4824007`, mas falta interação Android/GPS físico e integração. Corridas **pagas** só podem ser liberadas quando houver prova do modelo de custódia/liquidação, Pix externo se contratado, cancelamentos e disputas; `allocation` não é reserva real. |
| **5 — V0/V1** | **Jornada comercial E2E e Beta Gate**: contas fictícias + transições reais na interface, mobile, fluxos de erro, autorização, compatibilidade de versões, fiscalização de logs, LGPD/termos, checksum de deployment, plano de reversão. | Itens #63–67; PRs candidatas já testadas; documentos de políticas e consentimento. | Relatório único de `PASS/FAIL/BLOQUEADO` por jornada, deploy SHA confirmado e testes autenticados em dispositivo/navegador compatível. Não lançar funcionalidades fora do escopo aprovado. |

**Decisão comercial ainda não presumida:** caso o PSP não comprove proteção do valor do frete, é possível avaliar uma V1 **sem corridas pagas Kyrub**, com retirada/atendimento local quando os fluxos próprios estiverem autorizados, **somente mediante decisão do proprietário**. Se entregas pagas forem requisito obrigatório da V1, o lançamento dessa oferta continua bloqueado até resolver o rail. Nunca substituir por repasse manual ou saldo disponível do lojista.

**Separar dois trilhos de Pix:** checkout dos **planos oficiais** (recebedor da plataforma) ≠ pagamentos de **pedidos dos lojistas** (conta OAuth) ≠ **pagamento aos entregadores**. Aprovação de um não libera os outros. Não abrir checkout, cobrar R$ 1 de piloto, integrar split, conceder Pitangas ou publicar loja sem os gates específicos.

### Mapa dos 67 itens históricos — prioridade sem apagar o backlog

Cada número abaixo aparece exatamente uma vez no mapa. É **ordem de atenção**, não atualização automática do estado histórico registrado no item:

| Prioridade | Itens originais | Interpretação |
| --- | --- | --- |
| **V0 — fundação, segurança e fechamento** | **#1–9, #12, #17, #31, #45, #55, #57, #58, #62, #64–67** | Preservar autoridades e invariantes; confirmar que o que foi implementado continua válido; gates de produção e auditoria. |
| **V1 — jornada comercial e gamificação inicial** | **#10, #11, #13–15, #18, #32–37, #53–54, #63** | Fechar apenas as lacunas da venda real, pós-venda, recompensas iniciais e E2E. #11 é `OWNER_GATE` para dinheiro real. |
| **V1-ENTREGAS — condicional a rail financeiro** | **#16, #19–21** | PSP, split/settlement e garantia do frete. #16 (taxa/split 1:1) não deve ser ativado sem comissão aprovada; não é substituto de 1:N. |
| **V2 — expansão preservada** | **#22–30, #38–44, #46–52, #56, #59–61** | Omnichannel, clube completo, resgates, desafios avançados e automações de governança. **Exceção:** qualquer integração/recompensa dessas frentes exposta na V1 herda imediatamente gates V0 de segurança, autorização, tenant e orçamento. |

### Registro de frentes ativas (fotografia verificada em 17/11/2026)

| Frente canônica / PR | Estado comprovado | Próxima ação concreta |
| --- | --- | --- |
| **#1144** Praça, Comunidades e Kyrubia Educadora | `IMPLEMENTADO_PR` / incorporada em candidato acumulado [#1152](https://github.com/kyrub-app/kyrub/pull/1152), isolado e validado; a #1144 preserva origem de #1140/#1142/#1143. | Revisão de release/visual Android e autorização separada, sem considerar CI = deploy. |
| **#1152** V1 comércio + Praça/Comunidades/Kyrubia | `TESTADO_ISOLADO`: HEAD `0cfc15db` com **11/11 workflows PASS**; Firestore **279/279**, prebuild **2.273/2.273**, Chromium/Playwright verdes. | Opção de release sem nova economia; visual Android/PSP e autoridade de produção continuam obrigatórios. |
| **#1153** V1 comércio + social + contratos de Pitangas/XP | `TESTADO_ISOLADO`: HEAD `617e88bb`, **13/13 workflows PASS**, Firestore **279/279**, prebuild **2.273/2.273**, testes welcome **48+26+6**. | **Não ativar** writers/flags/recompensas até inventário Firebase completo e homologação de staging; sem merge/deploy prematuro. |
| **#1139** ERP → Marketplace / produtos e pedidos | `IMPLEMENTADO_PR` / testes e emulador aprovados no head relatado; ainda sem merge. | Conciliação com pedido/carrinho/estoque canônicos e inclusão em lote seguro. |
| **#1138** cupom ERP → Praça → vitrine → plano oficial | `TESTADO_ISOLADO` / Pix simulado e Chromium comprovados; sem cobrança real nem merge. | Revisar o piloto oficial separado, contrato Pix e interações com #1137; não habilitar checkout real sem liberação. |
| **#1146** segurança de reembolsos | `IMPLEMENTADO_PR`, em draft; correções de janela concorrente e histórico parcial. | Revisão de integração com serviços canônicos e gate de refund E2E. |
| **#1137** gamificação inicial | `TESTADO_ISOLADO`, integrada ao código comercial/social apenas na candidata [#1153](https://github.com/kyrub-app/kyrub/pull/1153). Atestação de escritores Firebase e ativação ainda bloqueadas. | Confirmar revisões/identidades externas e vedação de escritores legados; sem `writersVerified:true`, campanhas ou créditos reais. Não reaplicar PRs antigas. |
| **#1145** entregas / suporte / devolução | `TESTADO_ISOLADO`, origem da candidata [#1154](https://github.com/kyrub-app/kyrub/pull/1154). Testes originais 302/302; lote conjunto 317/317 Firestore. | Não operar entregas reais: liberar só após Android/GPS físico, lei/documentos, regras Firebase e liquidação do frete comprovada. |
| **#1154** V1-ENTREGAS após comércio/social/gamificação | `TESTADO_ISOLADO`: HEAD `1ec349af`, **13/13 CI PASS**; Firestore **317/317**, prebuild **2.360/2.360** e Browser/Chromium aprovados. | Candidata **separada** de #1153. Exigir deploy coordenado de regras + app, E2E GPS, responsabilidade e PSP 1:N antes de produção. |
| **#1147** arquitetura financeira split/liquidação | `IMPLEMENTADO_PR` documental/técnico; decisão comercial externa pendente. | Aguardar suporte Mercado Pago sobre segregação real do frete, recebedores após pagamento, Pix externo, custos, estornos/disputas; PSP alternativo se necessário. |
| **#1136** Produtos e Estoque | `PRODUCAO_VERIFICADA` no escopo de correção manual aprovado em 15/11; inspeção rede/console opcional. | Não reabrir ou refazer; observar regressão somente se houver evidência nova. |
| **PRs antigas #1135/#1132/#1130/#1128 e legados de pagamentos/ERP** | `AUDITORIA_PENDENTE` quanto à substituição/incorporação; algumas foram superadas por PRs posteriores. | Inventariar dependências antes de encerrar ou mesclar; nunca somar cada PR antiga como funcionalidade faltante. |

**Reconciliação técnica em execução:** [matriz de integração das PRs #1139, #1146 e #1138](docs/commerce/V1_PR_INTEGRATION_RECONCILIATION_2026-11.md). A [PR #1149](https://github.com/kyrub-app/kyrub/pull/1149), HEAD `d5d3c61a`, integrou #1139 + #1146 e recebeu a correção V0 da [PR #1150](https://github.com/kyrub-app/kyrub/pull/1150); **8/8 workflows GitHub passaram** no SHA integrado. A [PR #1151](https://github.com/kyrub-app/kyrub/pull/1151) reúne #1138 ao candidato, com 27 blobs originários inalterados e 4 arquivos conciliados; **11/11 workflows GitHub Actions aprovados** no commit atualizado `d0e87e4d`, incluindo E2E adicional varejo → Pix simulado → KDS → estoque e proteção de reembolsos (Firestore **279/279**, mais **3/3 e 5/5** complementares). CI de build, Phase 10, segurança, Playwright, Chromium e gamificação também passou. **Homologação isolada não é Beta Gate de produção**.

**Bloqueio V0 da auditoria produtiva — corrigido na candidata, sem release:** a primeira versão da #1149 (`e0bee320`) falhou em `production-dependency-security` com **4 ocorrências altas** no grafo de produção (lockfile idêntico à `main`). A [#1150](https://github.com/kyrub-app/kyrub/pull/1150) reclassificou Vite/plugins e utilitários de teste como dependências de desenvolvimento, com importação dinâmica de Vite somente no modo dev; o bloqueio não foi mascarado. A #1150 teve **8/8 workflows aprovados**; a #1149 corrigida (`d5d3c61a`) teve **8/8 aprovados**, inclusive Phase 10/audit de produção **sem ocorrências altas ou críticas**. Permanecem 1 baixa/6 moderadas no grafo produtivo e 6 altas no audit completo (inclui tooling). **V0 de audit produtivo resolvido no candidato, mas Beta Gate continua aberto**, sem merge, deploy ou cobrança.

**Verificação cruzada adicional (#1151):** [Firebase Emulator run 44157965322](https://github.com/kyrub-app/kyrub/actions/runs/44157965322) executou de fato os subtestes 74 e 75 no SHA `d0e87e4d`. Comprovados KDS condicionado ao pagamento, baixa/restauração de estoque idempotente e bloqueio da devolução integral diante de parcial incerto; **não** comprovadas devolução PSP real, simultaneidade financeira PSP, Android nem produção.


**Integração social adicional (#1152):** [PR #1152](https://github.com/kyrub-app/kyrub/pull/1152), SHA `0cfc15db`, acumula código testado de #1151 e 11 arquivos da #1144 (9 idênticos + 2 conciliados); **11/11 CI PASS**, Firestore **279/279**, prebuild **2.273/2.273** e navegador Chromium/Playwright aprovados. Não foram integradas as 68 alterações da gamificação #1137. Os dois pontos de sobreposição com o candidato são `server.ts` e `KyrubTab.tsx`; a atestação dos escritores Firebase continua sendo bloqueio independente de ativação de saldos reais.

**Integração final de gamificação em testes (#1153):** [PR #1153](https://github.com/kyrub-app/kyrub/pull/1153) HEAD `617e88bb` incorpora 68 arquivos da #1137 (66 blobs integrais, dois reconciliados) sobre a #1152. **13/13 workflows CI aprovados**, Firestore **279/279**, prebuild **2.273/2.273**, Auth/Functions Emulator **6/6** e contratos Pitangas **48/48 + 26/26**. O workflow de release de escritores é manual e continua **bloqueado**; a ferramenta de atestação passar no CI **não prova** o inventário implantado. Todos os ganhos/flags/fences permanecem sem ativação real.

**Integração de Entregas isolada (#1154):** [PR #1154](https://github.com/kyrub-app/kyrub/pull/1154), HEAD `1ec349af`, trouxe a #1145 inteira para uma branch **separada** após a V1 comercial/social/gamificação. 92 blobs da origem preservados e dois arquivos reconciliados; **13/13 CI PASS**, Firestore **317/317** e prebuild **2.360/2.360**, sem perder testes comerciais. Isso **não** libera entregadores reais, rastreio em aparelho físico, obrigação de frete nem o rollout coordenado de regras Firestore e aplicativo. #1153 permanece a candidata comercial; #1154 só poderá ser considerada para V1-ENTREGAS após gates adicionais.

### Diretriz atual de produto — estabilização pós-publicação, não novo lançamento (17/11/2026)

**Decisão do proprietário:** Kyrub **já está no ar**. A meta imediata não é anunciar outro lançamento: é **corrigir, integrar e verificar a aplicação publicada** para admitir novos usuários e o primeiro cliente pagante. Priorizar em conjunto **lojista/ERP + guia Renda + gamificação inicial**, sem abrir artificialmente uma fila de lançamento por módulo. Manter o pente-fino transversal de toda a plataforma; diferenciar os serviços que podem ser apresentados ao público daqueles que têm ativação financeira/operacional bloqueada. CI em PR não é prova de implantação nem de disponibilidade comercial.

**Jornada de atenção prioritária:** identificação e onboarding → bônus único elegível de **100 Pitangas** (ainda sob writer gate) → Praça, conexões e desafios → **Criar minha loja = Free** sem publicação → **publicar primeira loja = 2 XP e zero Pitangas** → catálogo/ERP/Marketplace → plano Pro ou Business com Pix confirmado (ainda sem liberação de checkout) → compra de terceiro/CRM/pedido/estoque → entrega/freelancer quando seguros → avaliação e publicação vinculada na Praça → curtidas, Salvos, notificações, Comunidades e Kyrubia Educadora. **Ação transversal só pode ser considerada pronta quando suas consequências nas superfícies de destino forem consistentes e testadas.**

**Auditoria dirigida no `main` (`008c6078435a312e05358a583ece6b148614a04e`) e candidata #1154 (`1ec349af`), com blobs correspondentes idênticos:**

- `src/components/PublicSocialFeedPanel.tsx` possui curtir, comentar e Salvar com armazenamento Firestore via `src/utils/savedLibrary.ts`, mas **não apresenta menu de três pontos** em cada cartão de publicação para **Conectar / Denunciar / Bloquear**. `src/hooks/usePublicSocialFeed.ts` usa `social_post_likes` e `social_post_comments`, sem lógica de recompensa monetária nas ações inspecionadas.
- `src/components/ConnectedContactsPanel.tsx` já apresenta Conectar nas Sugestões, chat nos conectados e menu Desconectar/Bloquear/Denunciar, **mas `reportFriend()` persiste somente em `localStorage`**, embora exiba mensagem de denúncia registrada para moderação. **Correção V0 de confiança/abuso:** não anunciar recepção pela moderação até existir persistência de servidor e retorno confiável; a mensagem de sucesso só pode vir de confirmação do backend.
- `firestore.social-feed.fragment.rules` **já prevê** a coleção `social_post_reports`, com um único documento por post/denunciante e leitura restrita ao autor da denúncia ou administrador. `server/admin/socialModerationService.ts` permite remover post e dependências com auditoria no Control Plane, mas **a listagem administrativa atual mostra os 100 posts recentes, não uma fila de denúncias**. Conectar o fluxo de denúncia → triagem humana → decisão/auditoria, sem deletar automaticamente a publicação por número de denúncias.
- **Nova regra candidata, não ativada:** conceder Pitangas por publicação/compartilhamento **somente quando uma campanha ou desafio estiver explicitamente habilitado**, com autoria autenticada, evento canônico no servidor, unicidade, limite temporal e antifraude; nunca conceder por clique client-side, repetição, autopromoção ou postagem removida. Não alterar os valores já definidos (100 Pitangas elegíveis no cadastro, 2 XP e 0 Pitangas pela primeira publicação da loja) nem desbloquear `writersVerified` até atestação.
- **Conexões e avaliações** são gates transversais a verificar: pedido de conexão ≠ chat habilitado sem aprovação; avaliações de loja compartilhadas na Praça devem referenciar o mesmo item canônico e curtidas/reputação sem contagem duplicada; Salvos devem manter referência privada, independente de Comunidades e sem violar visibilidade do autor.

**Prioridade de trabalho pós-auditoria:** (1) V0 denúncias reais e acesso/moderação, (2) V1 loja/renda/Pix/pedido/cadastro, (3) V1 gatilhos seguros de gamificação e identidade, (4) V1 conexões sociais e avaliações integradas, (5) V1-ENTREGAS apenas após GPS físico, regras Firestore coordenadas e modelo financeiro, (6) Omnichannel e educação em profundidade conforme dados de produção/terceiros. Publicar cada correção existente por **release coordenado e autorizado**, nunca por mera aprovação de CI.

### Correção de confiança social e próxima conexão transversal (17/11/2026)

- **Correção isolada [#1155](https://github.com/kyrub-app/kyrub/pull/1155):** novo menu contextual na Praça, **Conectar** via diretório público e chat somente para conectados, denúncia de publicação e usuário com recibo Firestore imutável `social_post_reports`/`social_user_reports`. A denúncia de contatos deixa de ser uma gravação local `localStorage` com mensagem enganosa de sucesso. Alterações de regras Firestore exigem deployment coordenado autorizado.
- **Moderação humana:** `social-moderation-list` conserva posts recentes e inclui denúncias pendentes, a revisão administrativa audita justificativa, e exclusão de publicação **preserva** histórico de denúncias enquanto remove curtidas/comentários associados. Não há remoção automática por número de denúncias.
- **Candidata combinada [#1156](https://github.com/kyrub-app/kyrub/pull/1156):** integra os nove caminhos da #1155 à candidata #1153, preservando comércio, Praça, Kyrubia e os gates Firebase. O V0 `npm audit --omit=dev --audit-level=high` falha em #1155 isoladamente por herança da `main` anterior à correção #1150; a candidata #1156 já herda a correção de dependências produtivas. Confirmar o CI no SHA final antes de marcar `TESTADO_ISOLADO`.
- **Novo achado de auditoria loja ↔ Praça:** `src/LegacyApp.tsx` ainda cria avaliações de loja (`MomentsModal`) e suas publicações compartilhadas em **estado local**, sem garantia de ligação canônica à coleção `social_posts` ou à contagem de curtidas. Próximo bloco: rastrear os armazenamentos, modelar avaliação canônica vinculada ao post (um autor/uma avaliação/um ID) e assegurar contagem idempotente, exclusão, privacidade e moderação. **Não declarar avaliações ↔ Praça prontas apenas pela existência dos formulários**.
- **Gamificação social:** Pitangas por posts/compartilhamentos permanece ideia de desafio administrável, **não ativada**; requer atestação de escritores, budget, antifraude, rate limit e deduplicação de eventos. Não alterar bônus de cadastro (100 Pitangas elegíveis) nem primeira publicação de loja (2 XP, 0 Pitangas).
- Sem merge, deploy, publicação de regras ou alteração de usuários reais. Prioridades centrais continuam **lojista/ERP, Renda e gamificação**, com Praça/Comunidades/segurança como ligações transversais.

### Fila executável imediata — sem aguardar Mercado Pago nem Vercel

1. **Inventário e comparação:** congelar o `main` atual e mapear conflitos/arquivos sobrepostos de #1139, #1146, #1138, #1144, #1137, #1145 e #1147. Registrar o que já integra `main` e o que seria novidade real; evitar PR duplicada.
2. **Segurança de reembolso + catálogo/pedidos:** fechar revisão isolada da #1146 e a consistência da #1139 antes de qualquer Pix real; tratar blockers sem ampliar escopo.
3. **Gamificação:** a integração de código já passou na #1153 (**13/13 CI**); **falta atestação real de todos os escritores Firebase**, reconciliação de legado e staging implantado. `writersVerified` e campanhas seguem desligados.
4. **Release social/educação:** candidatos cumulativos #1152 (**11/11**) e #1153 (**13/13**) validados no CI; manter a opção de publicar a V1 sem economia ativa, e concluir visual Android autenticado, release authority e homologação externa antes de qualquer deploy.
5. **Fluxo de venda isolado:** a cadeia checkout → pagamento simulado → KDS → baixa/restauração de estoque e guardas parcial/integral **já passou** nos SHAs exatos #1152 e #1153 (subtestes 74/75; 279/279 Firestore). Não refazer sem regressão: faltam refund PSP real, CRM visual, Android e Beta Gate.
6. **Entregas:** candidata combinada [#1154](https://github.com/kyrub-app/kyrub/pull/1154) já **13/13 CI verde** (317 Firestore, 2.360 prebuild). Preservar fronteira V1-ENTREGAS separada: faltam E2E interativo/GPS real, regras Firebase coordenadas, qualificação/legal e prova de liquidação PSP.
7. **Mercado Pago:** aguardar número/protocolo e resposta do suporte; nenhuma ativação financeira antecipada.
8. **Gate final:** fechar #63–67 para a **V1 delimitada**, publicar só com autorização explícita e prova de deployment. Itens V2 continuam registrados na lista-mãe, sem serem eliminados.

### Definição objetiva de conclusão

- **Um bloco de código está pronto** quando seus contratos/autorizações, testes e integração estão demonstrados na versão candidata exata.
- **Uma frente funcional isolada está encerrada** quando seu E2E de serviços em emulador passou e riscos/pendências visuais são documentados; isso não equivale a lançamento.
- **A V1 comercial está apta para autorização** apenas quando checkout/benefícios realmente oferecidos têm prova financeira, fluxos essenciais foram exercitados na interface real, conflitos transversais foram resolvidos e os gates de segurança/legais estão aprovados.
- **Produção está verificada** somente quando o deployment servido corresponde ao SHA esperado e os smoke tests pós-publicação passam. Sem inventar sucesso de Pix, entrega, reembolso, saldo ou campanha.

---

## Regra de execução

Tratar esta lista como fila contínua de trabalho. Executar os itens respeitando dependências, sem interromper para solicitar “continue”. Trabalhos independentes podem ser executados em paralelo.

Só interromper a frente bloqueada quando houver **AÇÃO DO PROPRIETÁRIO NECESSÁRIA**, como KYC, MFA, aceite contratual, fornecimento seguro de credencial, decisão comercial/jurídica ou autorização irreversível. As demais frentes independentes continuam.

Nenhum agente pode considerar merge = produção. Nenhuma ação financeira pode ser inferida pelo frontend. Nenhuma credencial pode aparecer em chat, código, log, Firestore em plaintext ou resposta ao navegador.

## Legenda de acompanhamento

- ✅ implementado e integrado com evidência suficiente
- 🟡 em andamento / parcialmente implementado / aguardando release gate
- ⏸️ bloqueado corretamente por Owner Gate
- 🔎 reconciliação necessária antes de implementar gaps
- ⬜ pendente

---

# FASE 0 — Sincronização e Release Authority

## 1. ✅ Resolver #284 — PRODUCTION_BEHIND_MAIN

Diagnosticar por que produção permaneceu no commit #280 enquanto #281/#283 já estavam na main.

Corrigir a causa raiz, não simplesmente disparar redeploy manual.

**Status atual:** concluído. A causa raiz de produção atrás da `main` foi corrigida e o fluxo atual não usa redeploy manual como substituto do release pipeline.

## 2. ✅ Confirmar production SHA === expected main/release SHA

Verificar o deployment efetivamente servido por www.kyrub.com.

Registrar a causa da divergência e sua correção.

**Status atual:** incorporado ao release gate operacional; todo fechamento de onda compara SHA esperado e deployment servido.

## 3. ✅ Criar Production Release Gate

Formalizar:

GitHub main → CI → Vercel deployment → deployment SHA → runtime verification

Nenhum agente poderá declarar algo “em produção” apenas porque o PR foi mergeado.

**Status atual:** vigente. O procedimento é aplicado nas releases atuais.

---

# FASE 1 — Admin → Vault → Payments

## 4. ✅ Criar Mercado Pago → Configurar

No admin.kyrub.com.

O segredo:

browser → backend → Vault

Nunca:

browser → Firestore

e nunca retorna integralmente ao frontend.

**Status atual:** implementado.

## 5. ✅ Implementar Credential Lifecycle

Cada integração deverá possuir metadados como:

provider;

environment (sandbox | production);

status;

masked fingerprint;

createdAt;

lastValidatedAt;

lastRotatedAt;

revokedAt;

audit correlation;

kill switch.

**Status atual:** fundação implementada e utilizada pelo Vault de integrações.

## 6. ✅ Construir Provider Credential Resolver

Admin
 ↓
Vault
 ↓
Credential Resolver
 ↓
MercadoPagoPixProvider

O provider deixa de depender diretamente de MERCADO_PAGO_ACCESS_TOKEN.

Fallback temporário por ENV só poderá existir se explicitamente controlado durante migração.

**Status atual:** implementado.

## 7. ✅ Implementar Testar conexão

O Admin solicita teste server-side.

Resultado possível:

connected | invalid | expired | insufficient_scope | unavailable

Nunca retornar o token.

**Status atual:** implementado server-side.

## 8. ✅ Preparar Webhook Management

Cadastrar/validar:

Mercado Pago → Kyrub webhook

com verificação de assinatura e consulta autoritativa do pagamento.

**Status atual:** webhook autoritativo e verificação implementados; credencial de webhook armazenada em Vault.

## 9. ✅ Credential Rotation / Revocation

Permitir trocar credencial sem alterar código.

Registrar tudo no Audit Trail.

**Status atual:** lifecycle/rotação/revogação fazem parte da autoridade de credenciais.

---

# FASE 2 — Sandbox + E2E Pix

## 10. 🟡 Criar Sandbox Gate

Antes de dinheiro real:

test account → test credential → Pix → webhook → PaymentIntent

Sempre que o PSP permitir.

**Status atual:** infraestrutura de provider/intents/webhook existe; execução sandbox completa ainda precisa ser fechada conforme capacidade oficial do PSP.

## 11. ⏸️ Executar E2E X-Burger

Cliente
 ↓
Loja Kyrub
 ↓
X-Burger
 ↓
Checkout
 ↓
PaymentIntent
 ↓
Mercado Pago Pix
 ↓
Pagamento
 ↓
Webhook
 ↓
confirmação autoritativa
 ↓
KDS
 ↓
produção
 ↓
entregador
 ↓
entrega

**Status atual:** Owner Gate. Depende de produto legitimamente vendável e de confirmação explícita imediatamente antes de qualquer Pix real.

## 12. ✅ Confirmar Financial Authority

O frontend jamais executa algo equivalente a:

paid = true

Pagamento somente muda de estado por evidência autoritativa do backend/provider.

**Status atual:** implementado e protegido por contratos.

## 13. 🟡 Failure E2E

Testar:

Pix expirado;

pagamento cancelado;

timeout;

webhook duplicado;

webhook atrasado;

webhook fora de ordem;

replay;

PSP indisponível;

resposta desconhecida.

**Status atual:** matriz fail-closed e regressões do webhook implementadas nas PRs #318/#322. Falta fechar fixtures de integração do processor/provider/Firestore para chamar o item de E2E completo.

## 14. ⬜ Refund E2E

Testar:

refund total

e

refund parcial

com reconciliação de PaymentIntent, pedido, allocations e ledger.

**Status atual:** pendente; será atacado após o fechamento de #13 sem depender do Pix real.

---

# FASE 3 — Marketplace Payments / Split

## 15. 🔎 Implementar Seller Connection

Lojista conecta sua própria conta Mercado Pago através de OAuth.

Nunca solicitar token no chat da Kyrubia.

**Status atual:** reconciliação necessária com as fundações financeiras/onboarding existentes antes de implementar gaps.

## 16. 🔎 Implementar Split 1:1

Primeiro modelo:

comprador
   ↓
Mercado Pago
 ↙       ↘
lojista   Kyrub
          application_fee

**Status atual:** reconciliação necessária.

## 17. 🔎 Separar Payment de Allocation

Formalizar:

Payment
↓
Allocation
↓
Settlement
↓
Reconciliation

Allocation ≠ dinheiro liquidado.

**Status atual:** existe `paymentAllocationEngine`; reconciliar o contrato completo antes de marcar gaps.

## 18. 🔎 Entregador permanece como obrigação no Ledger

Enquanto não existir rail autorizado:

deliveryAllocation

registra quanto deveria receber.

Mas o Kyrub não improvisa custódia ou repasse financeiro pela própria conta.

**Status atual:** reconciliação necessária com Allocation/Ledger existentes.

## 19. 🔎 Criar Settlement Adapter

Contrato independente de PSP.

Possíveis implementações futuras:

Mercado Pago 1:N;

PagBank;

Pagar.me;

outro PSP qualificado.

**Status atual:** reconciliação necessária.

## 20. ⬜ PSP Qualification Matrix

Comparar:

Mercado Pago | PagBank | Pagar.me | outros

por:

Pix;

OAuth;

seller onboarding;

1:1;

1:N;

refunds;

webhook;

KYC;

settlement;

recipient onboarding;

sandbox;

produção;

suporte;

custos.

**Status atual:** pendente.

## 21. ⬜ Mercado Pago 1:N — Commercial Gate

Verificar oficialmente possibilidade de habilitação para o Kyrub.

Não bloqueia o MVP 1:1.

**Status atual:** pendente; será tratado como gate comercial, sem bloquear 1:1.

---

# FASE 4 — Store Connections / Omnichannel Onboarding — #285

## 22. 🟡 Kyrubia identifica canais existentes

Durante ativação da loja:

> “Você já vende em algum lugar?”

Exemplos:

Mercado Livre / Shopee / iFood / 99Food / Instagram / ERP / outros

**Status atual:** domínio e reconhecimento determinístico de canais implementados na PR #319; integração plena ao onboarding/Kyrubia ainda pendente.

## 23. 🟡 Criar Store Connection Registry

Separar rigorosamente:

PlatformConnection

de

StoreConnection.

**Status atual:** domínio separado na #319 e persistência server-authoritative/tenant-scoped na #323; release final da segunda onda ainda precisa do Production Release Gate.

## 24. ⬜ OAuth por lojista

Quando disponível:

Kyrubia
→ Conectar Mercado Livre
→ OAuth oficial
→ autorização
→ backend
→ Vault

Nunca:

> “mande seu token aqui”.

## 25. ⬜ Descoberta do catálogo

Depois da autorização:

discover products

sem importar automaticamente.

## 26. ⬜ Preview de importação

Mostrar:

produtos;

categorias;

preços;

imagens;

estoque;

possíveis conflitos.

## 27. ⬜ Confirmação humana

Somente após confirmação:

preview → confirm → import

## 28. 🟡 Provenance

Cada dado importado sabe sua origem:

manual
mercado_livre
shopee
ifood
99food
csv
ai
...

Com:

externalId / connectionId / importedAt / lastSyncedAt.

**Status atual:** contrato de provenance entrou na #319; aplicação completa aos imports ainda pendente.

## 29. 🟡 Sync Authority

Definir quem é autoridade após importação.

Exemplo:

Mercado Livre → Kyrub

ou

Kyrub → Mercado Livre

ou

bidirectional

quando seguro.

**Status atual:** enum/contrato de autoridade entrou na #319; configuração operacional ainda pendente.

## 30. 🟡 Tenant Isolation

Uma Store Connection jamais pode acessar credenciais ou dados de outra loja.

**Status atual:** tenant assertion e registry server-side entraram nas #319/#323; ainda serão adicionadas regras/testes de autorização end-to-end quando o registry for exposto ao produto.

---

# FASE 5 — Gamificação: Fundação

Aqui aplicaremos primeiro uma regra:

> Reconciliação antes de implementação.

Como parte dessa fundação já entrou na Wave anterior, o Gamification Agent primeiro classifica cada requisito como:

implemented | partial | missing

e implementa somente os gaps.

## 31. ✅ Formalizar economias separadas

Clube da Loja

Kyrub Clube

K-Coins

E:

XP ≠ K-Coins

Pontos da loja ≠ K-Coins

K-Coins ≠ saldo financeiro

**Status atual:** contrato explícito integrado na #320, incluindo separação de Créditos Kyrubia.

## 32. 🟡 Consolidar domínio Gamification

Challenges, participações, evidências, conquistas, recompensas, vouchers, expiração e antifraude.

**Status atual:** `shared/gamification.ts` já contém base significativa de challenges/rewards/claims; consolidação continua.

## 33. 🟡 Consolidar Reward Ledger

Toda movimentação contém:

user;

origin;

challenge;

timestamp;

reason;

correlationId;

idempotency key.

Saldo sempre derivável.

**Status atual:** builder auditável e idempotência adicionados na #324 sobre o ledger existente; release final da segunda onda ainda precisa do Production Release Gate.

## 34. ⬜ Antifraude

Cobrir inicialmente:

multi-account;

autoindicação;

farming;

evidência falsa;

resgate duplicado;

replay;

rate limiting.

## 35. ⬜ Governança econômica

Admin acompanha:

emitido / circulando / resgatado / expirado

e limites de emissão.

---

# FASE 6 — Kyrub Clube

## 36. 🔎 Criar experiência Kyrub Clube

Página com:

K-Coins;

XP;

nível;

desafios;

conquistas;

histórico;

recompensas.

**Status atual:** reconciliar UI/fundações existentes antes de implementar gaps.

## 37. 🔎 Challenge Engine

Desafio possui:

objetivo / descrição / período / público / critérios / evidência / recompensa / orçamento / status

**Status atual:** existe `KyrubChallengeDefinition`; reconciliar campos e persistência/execução.

## 38. 🟡 Tipos de validação

Suportar:

automática;

evidência;

feed;

integração externa;

comunitária;

manual;

Kyrubia-assisted.

**Status atual:** modos equivalentes já existem no domínio compartilhado; falta execução completa por modo.

## 39. ⬜ Feed como evidência

Publicações podem comprovar progresso.

Mas:

postar ≠ automaticamente cumprir desafio.

## 40. 🔎 Catálogo global de recompensas

K-Coins podem ser trocados por benefícios definidos.

Sem paridade monetária automática.

**Status atual:** `KyrubRewardDefinition` já existe; reconciliar catálogo/persistência/UI.

## 41. ⬜ Redemption Engine

Resgate:

atomic debit → voucher único → validade → audit event

com proteção contra duplicação.

---

# FASE 7 — Clube da Loja

## 42. 🔎 Criar Clube da Loja

Cada estabelecimento possui:

membros;

fidelidade;

campanhas;

vouchers;

benefícios;

regras.

## 43. 🔎 Desafios próprios

Lojista pode criar desafios para seus clientes.

## 44. 🔎 Funding local

Recompensas da loja são financiadas pela própria loja.

## 45. ✅ Separação econômica

Nenhuma conversão automática:

Pontos Loja ↔ K-Coins

**Status atual:** invariável explícita adicionada na #320.

## 46. 🔎 Loja oferecendo benefícios ao Kyrub Clube

Exemplo:

500 K-Coins → voucher da Loja X

## 47. ⬜ Campaign Dashboard

Lojista acompanha:

orçamento;

participantes;

resgates;

conversão;

receita atribuída.

## 48. ⬜ Sponsored Challenges

Preparar:

marca financia
↓
Kyrub distribui
↓
usuário participa
↓
reward
↓
marca recebe métricas

---

# FASE 8 — Gamificação transversal + Kyrubia

## 49. 🔎 Desafios multidomínio

Permitir desafios de:

empreendedorismo;

estudo;

freelancer;

entregas;

compras;

vendas;

comunidade;

perfil;

conteúdo;

indicação.

## 50. 🔎 XP / Level / Achievement

Formalizar separadamente:

XP

Level

Achievement

Badge

K-Coin

**Status atual:** XP e K-Coin já estão separados; reconciliar Level/Achievement/Badge.

## 51. ⬜ Kyrubia Gamification Assistant

A Kyrubia poderá:

encontrar desafios;

explicar regras;

acompanhar progresso;

informar recompensa;

sugerir oportunidades.

## 52. ⬜ Opportunity → Challenge Engine

O Opportunity Engine poderá gerar propostas de desafios/campanhas.

Nunca publicar automaticamente sem política de autonomia.

## 53. 🟡 Reward Funding Authority

Toda recompensa declara quem paga:

Kyrub | loja | patrocinador | parceiro | combinação

**Status atual:** funding/sponsor types já existem nas fundações; consolidar enforcement.

## 54. ⬜ Budget Guard

Campanhas possuem:

budget;

issuance cap;

redemption cap;

período;

kill switch.

Nenhum agente pode criar custo ilimitado.

---

# FASE 9 — Governance / Legal / Trust

Esta é a frente que faltava na lista consolidada.

## 55. ✅ Criar GovernanceDocument

Documento possui:

type / version / hash / status / owner / createdAt / approvedAt / publishedAt.

**Status atual:** domínio implementado na #321.

## 56. 🟡 Central de Governança

No Admin:

Jurídico / Privacidade / Termos / Pagamentos / IA / LGPD / Contratos / Políticas.

**Status atual:** repository server-authoritative para a Central entrou na #325; interface/admin transport ainda pendentes e release final da segunda onda ainda precisa do Production Release Gate.

## 57. ✅ Document Lifecycle

DRAFT
↓
LEGAL_REVIEW
↓
APPROVED
↓
PUBLISHED
↓
SUPERSEDED

**Status atual:** lifecycle e transições válidas implementados na #321.

## 58. 🟡 Versioned Consent

Registrar:

> Termos v1.3 — aceito por usuário X — timestamp Y.

**Status atual:** domínio e persistência server-side implementados nas #321/#325; integração com pontos de aceite do produto ainda pendente.

## 59. ⬜ Legal Drift Detector

Mudança relevante no produto pode gerar:

> ⚠️ Esta alteração pode tornar a Política de Privacidade desatualizada.

## 60. ⬜ Compliance Agent Integration

Observar principalmente:

Payments / AI / Gamification / Store Connections / Logistics.

## 61. ⬜ Release Compliance Gate

Mudanças classificadas como materialmente relevantes podem exigir revisão antes da produção.

## 62. ✅ Human Legal Gate

IA pode:

detectar → comparar → apontar → preparar

Mas aprovação/publicação jurídica permanece uma decisão humana apropriada.

**Status atual:** princípio preservado no domínio e nos fluxos atuais; nenhuma automação pode publicar aprovação jurídica sozinha.

---

# FASE 10 — Final Integrated Validation

## 63. ⬜ Cross-domain E2E

Executar cenário atravessando vários domínios.

Por exemplo:

lojista conectado
→ produto
→ cliente compra
→ Pix
→ KDS
→ entrega
→ conclusão
→ XP/K-Coins quando aplicável
→ voucher
→ audit trail

## 64. ⬜ Security Regression

QA Agent executa revisão independente:

auth / tenant isolation / secrets / payments / ledger / replay / privilege escalation.

## 65. ⬜ Production Verification

Novamente:

expected SHA === deployed SHA

smoke tests.

## 66. ⬜ Documentation Drift

Comparar implementação final contra:

arquitetura;

roadmap;

documentação técnica;

documentos jurídicos;

contratos MCP/API.

## 67. ⬜ Phase Closeout

Gerar relatório único:

implemented / partial / blocked / failed / owner action

e construir a próxima fila a partir de gaps reais, não de ideias duplicadas.

---

# Workstreams oficiais

🔴 **Critical Path: #1 → #21** — produção + Mercado Pago + E2E + split.

🔵 **Product: #22 → #54** — Omnichannel + Gamificação + Clubes.

🟣 **Governance: #55 → #62** — Compliance / Legal / Trust.

Os **#63–#67** voltam a reunir tudo para validação final.

## Owner Gates atualmente abertos

- ⏸️ #11 — primeiro E2E Pix real do X-Burger: aguarda produto legitimamente vendável e confirmação explícita imediatamente antes de dinheiro real.
- ⏸️ Teste real BYO-AI fora desta bateria de 67: proprietário fará diretamente em `Minha IA`, sem enviar chave em chat.
