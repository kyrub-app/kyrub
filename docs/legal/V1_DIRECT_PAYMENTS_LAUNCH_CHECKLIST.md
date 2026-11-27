# V1 comercial — recebimento direto e logística independente

Decisões do proprietário em 27/11/2026. Freelas é requisito de lançamento. Isenção da comissão transacional do Kyrub nos primeiros meses (data final ainda não definida); tarifas dos provedores não subsidiadas pelo Kyrub. Planos e preços existentes preservados. Sem custódia, adiantamento ou repasse informal pelo Kyrub. Não depende de split 1:N. Nenhuma autorização de produção ou contratação implícita.

## 1. Política e inventário
- [x] Registrar escopo: Lojas com entregador próprio, Freelas comercial, Entregas avulsas/fretes independentes, logística integrada de pedidos desativada.
- [x] Registrar localização correta: Central Pessoal > Movimentações; CID separado.
- [x] Preservar homologação de Freelas #1434: build 45988962285 e Chromium 45988962508 aprovados.
- [x] Verificar fundação financeira #262 presente: shared/kyrubFinancialProfile.ts e server/payments/financialProfileOnboarding.ts (modelo e transições, não onboarding real).
- [x] Identificar WalletMovementsPanel em src/components/modals/WalletModal.tsx, reutilizado em UserProfileModal.tsx; hoje extrato local informativo, não conta financeira.
- [x] Identificar publicação de pedidos em server/delivery/deliveryOpportunityRouter.ts e KyrubDeliveryOpportunityBridge.tsx; ainda exige bloqueio efetivo em todos os caminhos.
- [x] Identificar formulário avulso DeliveryManagerModal.tsx: criação/aceite/avanço locais, não homologados como operação multiusuário.
- [x] Identificar barreira de financiamento Freelas em freelanceFundingService.ts: exclusivamente fixture; transporte e interface candidatos apenas locais.
- [ ] Reconciliar baseline produtiva, branches de Entregas e Freelas, rotas serverless, regras/índices e configurações atuais, sem alterar produção.

## 2. Contenção da logística integrada (primeiro bloqueio de lançamento)
- [ ] Inventariar origens KDS, checkout, ERP, webhooks, tarefas agendadas, rotas e clientes antigos; desligar novas publicações/novos aceites de pedidos de loja em servidor e interface.
- [ ] Preservar entregador próprio e retirada; retirar opção Entregador Kyrub da configuração/checkout enquanto inativa; não converter silenciosamente pedidos já contratados.
- [ ] Drenar ou tratar obrigações preexistentes por decisão auditada, sem apagar registros ou impedir conclusão/recebimento legitimamente contratado.
- [ ] Provar que pedido da loja nunca gera nova oportunidade integrada durante a suspensão; frete independente não usa pedido de loja.

## 3. Política econômica e Movimentações
- [x] Definir fundação pura versionada de condições de pagamento direto: antecipado ou na conclusão (padrão); Pix externo ou Mercado Pago; comissão zero; tarifas do provedor por conta do participante contratante do serviço financeiro. Ainda não conectada ao ciclo de vida.
- [ ] Versionar política de comissão no Control Plane (zero no lançamento, sem data de cobrança inventada); preservar preço e vigência dos planos.
- [ ] Reusar perfil financeiro por UID; separar vínculo empresarial do ERP, vínculo pessoal OAuth, chave Pix privada e CID público.
- [ ] Autorizar titular, validar formato, exigir confirmação de identidade/controle do destino; distinguir chave declarada de verificada, mascarar fora da operação, proteger troca e revogação, nunca armazenar segredos no perfil.
- [ ] Registrar condições imutáveis aceitas pelas partes, valor bruto, vencimento, destinatário, evidência e tarifas; sem saldo bancário fictício, custódia, transferência automática ou promessa de garantia.
- [ ] Exibir em Movimentações recebimentos, pagamentos, pendências e extrato, distinguindo previsto, devido, pagamento informado, recebimento declarado e conciliado pelo PSP; paginação, privacidade, troca de conta, auditoria.

## 4. Freelas (prioridade comercial)
- [ ] Adaptar publicação e aceite bilateral às condições de pagamento, apresentar antes da candidatura; registros antigos sem termos explícitos permanecem na política anterior ou bloqueados para revisão, nunca reinterpretados.
- [ ] Antecipado: iniciar somente após evidência da modalidade acordada; distinguir confirmação bilateral externa de confirmação do PSP; não prometer dinheiro retido. Na conclusão: permitir execução após aceite bilateral explícito e ciência do risco de inadimplência; obrigação nasce conforme contrato.
- [ ] Implementar obrigação canônica, prazo, declaração do pagador, confirmação independente do recebedor, duplicatas, disputa e correções; não registrar dinheiro recebido com mero comprovante ou declaração unilateral.
- [ ] Integrar MP pessoal via OAuth e cobrança no recebedor correto, sem application_fee/split, sem reutilizar credenciais de lojas ou plataforma; verificar pagamento/status/BRL/valor/vínculo, idempotência, estorno, tarifas, conciliação.
- [ ] Política de desistência, atraso, inadimplência, estorno e remuneração parcial: revisão jurídica e comercial; tratamento auditado de ocorrências e TOTP real em ambiente autorizado.
- [ ] Termos de serviço e distinção entre autonomia e vínculo empregatício, especialmente bares/restaurantes; sem alegação de que denominação freela afasta direitos trabalhistas.
- [ ] Homologar dois participantes reais/fictícios conforme ambiente, antecipado e conclusão, Pix externo e MP, falha, duplicata, conta trocada, cancelamento, disputa, recebimento, avisos e histórico; homologação financeira real somente autorizada.

## 5. Lojas
- [ ] Auditar conexão OAuth/recebedor, checkout, Pix e cartões disponíveis; Google Pay somente se integração suportada e homologada, sem promessa de débito/parcelamento universal.
- [ ] Provar pedido, pagamento confirmado, estoque, conciliação, cancelamento/estorno, entrega própria, nenhuma cobrança de comissão Kyrub e nenhuma oportunidade integrada.
- [ ] Preservar Loja Oficial, Pro/Business, Pix protegido e preços/limites; não ativar flags ou emitir cobrança real sem autorização.

## 6. Entregas avulsas
- [ ] Criar fluxo canônico independente de pedido ERP, identidade de solicitante e entregador, oferta/aceite exclusivo, endereços privados, rota real e confirmação de coleta/entrega.
- [ ] Condição de pagamento direto e remuneração por trabalho efetivo; regras para deslocamento, espera, retorno autorizado, cancelamento e ocorrência. Não cobrar automaticamente parte indevida nem impor repasse lojista-entregador.
- [ ] Reusar perfil, obrigação, estados de pagamento, extrato e sininho; separar prestação de transporte da logística integrada suspensa.
- [ ] Homologar duas contas, concorrência, geolocalização real quando possível, pagamento Pix externo/MP, privacidade, cancelamento e auditoria. Validar requisitos legais aplicáveis antes de operar.

## 7. Portões de lançamento
- [ ] Segurança: ingresso, elegibilidade, MFA administrativo e financeiro real, LGPD, regras e índices, autenticação revogada, permissões.
- [ ] Reconciliação integrada e regressão de ERP, NFC, perfil, Catu e operações financeiras; Kyrubia fora deste ciclo.
- [ ] Revisar custos, tarifas, condições contratuais, dependências do provedor e tratamento de suporte.
- [ ] Consolidar evidências e submeter lotes específicos à autorização do proprietário; somente depois merge/deploy e configuração produtiva autorizados. Sem migração destrutiva.
- [ ] Validar piloto comercial autorizado; nenhuma declaração de disponibilidade antes de comprovação.

Fora do escopo imediato: Split 1:N, logística integrada de pedidos, custódia/saldo próprio, crédito/adiantamento, pagamento parcial automático, novas taxas, Open Finance não autorizado, CID financeiro automático.

## Progresso da contenção — 27/11/2026
#1436 Application build 45996520511 aprovado; Store security rules ainda em execução quando consultado.
Nesta parcela: política compartilhada deliberadamente desativada, bloqueio de publicação no serviço antes do acesso ao banco, bloqueio de novo aceite integrado dentro da transação (replay do titular existente preservado), escalonamento integrado suspenso sem apagar fila, projeção pública integrada vazia sem consulta, bridge não assina pedidos para publicar, filtro de ofertas disponíveis e contador Catu. Não altera regras, contratos existentes, entrega própria, retirada ou dados. Projeção de cache histórica preservada para continuidade e teste de remontagem. Testes de política e serviços sem credenciais no prebuild, CI pendente. O fluxo legado de frete avulso ainda não é canônico. Ainda falta inventariar checkout/ERP/KDS e demais caminhos de escrita, compatibilizar #1409/#1414, limitar leituras privadas e tratar pendências antigas; não declarar bloqueio global/comercial concluído.

## Aceite do pedido no KDS — 27/11/2026
#1437 aprovou Application build 45997122724, Store security rules 45997122624 e Chromium Freelas 45997123368. A proteção não prejudicou a jornada operacional já homologada.
A escolha de entregador ocorre no aceite do pedido pelo CustomerOrderInbox. Acrescentada proteção dentro da transação de estoque/status em orderInventoryService: nova escolha Kyrub rejeitada; entrega própria requer confirmação explícita, repetição exata de pedido integrado já aceito preservada, modalidade persistida não convertida. API de execução devolve 409 com mensagem; modal omite escolha Kyrub enquanto suspensa e mantém entregador próprio. Retirada não entra na condição de entrega. Teste puro e contrato de integração no prebuild; CI pendente.
A inspeção de StorefrontPanel, PublicStorefrontApp e StoreConfigModal não encontrou seleção explícita deliveryProvider nesses arquivos; não equivale a auditoria de todos os componentes de checkout/configuração. Resta verificar componentes delegados, serviços de criação de pedidos e outros caminhos, além de prova transacional com emulador e inventário de obrigações já existentes. Não ativado comercialmente.
