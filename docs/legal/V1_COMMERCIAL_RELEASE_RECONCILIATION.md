# V1 comercial — mapa de integração e retomada dos Freelas

Data da inspeção: 27/11/2026. Documento de preparação, não autorização de merge, deployment, cobrança ou alteração do Firebase.

## Linhagem verificada no GitHub

- main na consulta: `4134b44e0351555dd9e3583adf6f279202ee842b`.
- Candidata comercial após #1577: `fde89a4bd8fc621ae47667c6adaa4fa0e2dc9210`; 938 commits à frente, zero atrás. A comparação expõe até 300 arquivos; não inferir total real de arquivos.
- #1519: `4459aeddc9bf3f780fb4982f7963cf794df95c77`, ancestral confirmado (265 commits seguintes).
- #1528 parte de #1519. #1527 `876894e74c8f6482150cfe527a2e36758dd6ea9e` diverge da candidata: 29 commits exclusivos do ramo de adiantamentos, 265 na comercial após a base comum. Manter #1520–#1527 fora da linha de lançamento.
- #1355 e #1380 divergem da candidata; não assumir integração do CID completo. A comparação não comprova ausência de código equivalente incorporado por outro commit. Reconciliar funcionalidades e SHA individualmente.
- #1409 e #1414 são branches paralelas de Entregas, não autorizar integração automática. Preservar suspensão comercial da logística integrada.

## Marcos de comparação (não são lotes aprovados de implantação)

| Base | Destino | Commits adicionais | Arquivos na comparação |
|---|---|---:|---:|
| main | #1436 `68681a6` | 266 | 293 |
| #1436 | #1440 `47c9e33` | 5 | 18 |
| #1440 | #1470 `6bda241` | 30 | 63 |
| #1470 | #1519 `4459aed` | 372 | 87 |
| #1519 | #1577 `fde89a4` | 265 | 72 |

Os blocos maiores exigem subdivisão. #1340 `fdfc718` e #1434 `396864d` são ancestrais confirmados, respectivamente a 184 e 264 commits da main consultada; usar como pontos de inspeção, não como autorização de deploy. Antes do primeiro lote: localizar ancestral mais próximo da produção efetiva, inventariar PRs e arquivos desse intervalo, verificar dependências de segurança/rotas/regras e status CI no SHA exato. Uma comparação com main não comprova qual SHA está em produção Vercel.

## Evidências Cocares preservadas

#1569–#1576: 21 verificações aprovadas conforme histórico. #1577 head fde89a4: build 46079885091, diretório social HTTP 46079885101, auditoria 46079885110 e visual 46079885419 aprovados. Artefato visual 15236721563, três larguras (337, 390, 1365). Componentes reais com respostas fictícias controladas; não confundir com publicação/encaminhamento comercial E2E. Projeção de XP permanece emulador e depende da cobertura de escritores externos. Não reabrir essa frente sem necessidade comprovada.

## Ordem de retomada

1. Reconciliar baseline de produção efetiva, main, linhagem comercial e branches paralelas sem mudança produtiva. Preparar primeiro lote pequeno e auditável; não realizar merge/deploy sem autorização específica.
2. Freelas: preservar #1519, Reputações e Experiência, Pix externo direto, condições imutáveis, apuração por jornada/preço fechado, restrição bilateral e resolução auditada. Adiantamento por jornada fora da V1. Nenhuma expansão econômica.
3. Distinguir CI emulador de prontidão comercial: rotas Express e flags locais não comprovam transporte Vercel, MFA real, regras de produção ou operação real do PSP. Inventariar essas diferenças e implementar apenas as lacunas autorizadas. Mercado Pago pessoal não presumido disponível; não reutilizar credenciais comerciais da loja.
4. Lojas com entrega própria e retirada, ERP/estoque/conciliação e NFC/CID preservados; logística integrada suspensa. Entregas avulsas independentes seguem checklist próprio.
5. Provar jornada integrada e regressão antes de cada autorização de implantação; manter Kyrubia fora do ciclo. Sem habilitar APIs cloud, contratar serviços, alterar regras ou parâmetros produtivos por inferência.

Fonte de decisões e evidências detalhadas: V1_DIRECT_PAYMENTS_LAUNCH_CHECKLIST.md. As tabelas acima são fotografias da consulta, devem ser atualizadas antes da autorização de cada lote.


## Reconciliação da produção efetiva — 27/11/2026

Consulta autenticada Vercel: projeto kyrub, aliases www.kyrub.com e admin.kyrub.com apontam para o mesmo deployment READY, target production, `dpl_rLB8Df2a81c6AvSvkp1RQLJm88BD`, commit `acebfca248d97cb2f28445280444171eee60f074`, branch release/kyrub-tag-permanent-stock, merge #1350 (CID — compartilhamento e visão autenticada do titular). Link: https://kyrub-ibhzm2csd-kyrubapp-6434s-projects.vercel.app. Nenhum segredo ou bypass registrado. Não houve promoção nem alteração de configuração.

Comparação GitHub: produção 232 commits à frente de main, candidata #1577 706 à frente da produção e zero atrás, 234 arquivos na resposta; #1578 no head anterior acrescenta um commit documental. Portanto substituir a main como referência de planejamento pela produção real (não redefinir main, não trocar branch produtiva).

| Marco | Commits cumulativos desde produção | Arquivos cumulativos |
|---|---:|---:|
| #1410 | 1 | 14 |
| #1411 | 2 | 19 |
| #1412 | 5 | 23 |
| #1413 | 7 | 26 |
| #1415 | 8 | 31 |
| #1436 | 34 | 60 |
| #1440 | 39 | 75 |
| #1577 | 706 | 234 |

Primeiro lote proposto: PR #1410, avisos de convites de notas e tarefas no sininho, diretamente sobre acebfca, head c03cc40106fc3d7a8638d7088b15fa0c13a2677c. PR aberta draft e mergeable na consulta, base exata release/kyrub-tag-permanent-stock. 1 commit, 14 arquivos, build 45972101040 e V1 social directory consumers 45972101024 aprovados. Serviço transacional verifica titular da nota, convite pendente, vínculo real de compartilhamento e chave determinística, sem alterar a modalidade financeira ou CID. A PR reutiliza a API de notificações; não acrescenta coleção ou regra conforme descrição e diff. Ainda falta prova funcional de duas contas em ambiente isolado, idempotência, invasão, revogação, tentativa de reenvio e navegação. Não considerar pronto para merge/deploy apenas pelo CI estático. Verificar transporte serverless efetivo e regressão CID antes da autorização específica. Não promover candidato inteiro.

#1409 (13 commits/12 arquivos desde produção), #1414 (1/7) e CID #1355 (29/15) são linhas paralelas a reconciliar individualmente; não misturar no primeiro lote. Em particular, não reativar logística integrada por incorporação automática das correções de Entregas.

Próximo passo: homologação funcional isolada de #1410 no SHA fixo ou candidato derivado contendo somente os ajustes mínimos necessários e teste, com conferência do diff e novo CI. Antes de qualquer implantação verificar novamente ambos os aliases, SHA base e autorização do proprietário.


## Atualização de fechamento — 28/11/2026

Não reabrir funcionalidades ou homologações já comprovadas. O checklist histórico contém caixas não atualizadas; tratá-las como evidência histórica, não como lista de implementação do zero.

- 20 lotes READY, 150 PRs contempladas; produção efetiva `895050250f596695593e6b31e450cdd7498b0aa1`, deployment `dpl_2ucBXgCPmHS8yutGoE5cBemuKTr3`, ambos os aliases confirmados. #1577 candidata `ed27e94f91dad0bbc52b456b366d1f19a1e30637`, 9/9 workflows aprovados, merge/deployment ainda não autorizados. Depois deste lote: 159 PRs contempladas em 21 implantações, não confundir com 100% de prontidão comercial.
- Evidências existentes: modelos e serviços de contratação, preço fechado/jornada, agenda, apuração, Pix direto, declarações bilaterais, divergências, regularização, cancelamentos, excedentes, Movimentações, Reputações e Cocares. Reutilizar CI e testes HTTP/Chromium isolados. Não reconstruir esses módulos.
- Lacuna concreta no SHA candidato: `server/freelance/freelanceWorkspaceTransport.ts` linhas 13–17 exige homologação local e rejeita Vercel; `server/freelance/freelanceFinanceTransport.ts` linhas 23–24 depende dessa barreira e retorna 503 quando desativada; `server/payments/personalPixTransport.ts` também exige emuladores e rejeita Vercel; `server/freelance/freelanceHourlyLifecycleGate.ts` exige NODE_ENV=test e emuladores, Pix externo na conclusão. Não retirar proteções indiscriminadamente. Trabalho restante: adaptação estreita do transporte/autoridade e gates produtivos, reaproveitando serviços e testes; provar autenticação, isolamento e jornadas essenciais antes de autorizar ativação. Não confundir isso com reimplementar a lógica financeira.
- #1355, #1380, #1409, #1414 continuam divergentes (29, 168, 13, 1 commits exclusivos, respectivamente, comparados ao SHA candidato); divergência não prova ausência funcional. Fazer comparação de equivalência e triagem de necessidade comercial, não merge automático ou expansão de escopo.
- Validações finais: comparar regras/índices e configuração realmente implantados, verificar evidências anteriores de ingresso/LGPD/MFA e não repetir testes aprovados sem motivo. Jornada ERP e Freelas real/piloto autorizada; entregas independentes conforme escopo aprovado e estado efetivo. Reputações/Cocares experimentais não devem ser ativados sem cobertura; não tornar otimizações cosméticas requisito artificial de lançamento. Mercado Pago pessoal, split 1:N e adiantamentos não devem bloquear o caminho Pix externo aprovado. Kyrubia permanece fora.
- Prioridade imediata: concluir #1577 após autorização, depois inventário curto de diferenças efetivas entre emulador e produção e classificação de bloqueios reais, sem novos desenvolvimentos laterais. Nenhuma autorização de produção, Firebase, cobrança ou migração implícita.
