# FinOps — inventário de fontes e critérios de conciliação V1
Issue #1278; base do contrato #1287 (b0c2420); auditoria estática main 4134b44 em 25/11/2026. Não foram acessados faturas, extratos, dados de usuários, IAM ou Firebase de produção. Não é prova de disponibilidade de um conector ou de saldo real.

## Receitas próprias
| Categoria | Evidência existente | Gate de conciliação |
|---|---|---|
| plans | server/payments/officialPlanPixCheckout.ts: checkout verificado, identidade do recebedor, valor, moeda, Pix, status accredited e data; em produção exige live_mode; escreve stores/{officialStoreId}/payments/official_pix_{providerPaymentId} e ledger econômico; materializa antes da ativação quando necessário. server/admin/officialStoreService.ts define identidade canônica. | Somente pagamento real confirmado, Loja Oficial, checkout/contrato/provedor correspondentes. Conciliar extrato MP, estornos, chargeback/reversões e taxas; excluir sandbox/fixtures e pagamento de teste conforme classificação documentada (piloto real não é automaticamente fictício). Não contar preço, direito de uso, cupom nominal, intenção ou contrato novamente. Verificar também fluxo legado paidPlanSubscriptionService.ts e reconciliação de cobranças históricas. Não presumir cobertura de devoluções. |
| ads | src/components/ads/KyrubAdsCommunityPromotionPreview.tsx explicitamente preview sem campanha, persistência, cobrança ou distribuição. | Fonte de pagamento e conciliação inexistentes nesta superfície; não inferir receita zero sem evidência de período/escopo. |
| tags | server/admin/kyrubTagPilotService.ts emissão experimental, não prova venda; projeto de homologação separado. | Venda confirmada pela autoridade comercial correspondente, custo de mercadoria/estoque e logística; não misturar emissão, ativação ou Firebase de homologação com venda. |
| platform_fees | server/admin/platformEconomyService.ts agrega economicLedger de todas as lojas; shared/storeEconomicLedger.ts separa capture/refund/chargeback/reversal. | Somente taxa efetivamente pertencente à plataforma, comprovada por settlement/extrato; GMV, remuneração de entregador, saldo de lojista e repasses são terceiros. Não classificar economicNetMinor como receita própria. |
| other_own_revenue | Não identificada fonte consolidada. | Comprovantes e classificação autorizada; atestado de cobertura antes de declarar zero. |

## Custos próprios
| Categoria | Fonte a obter sob autorização | Cuidados |
|---|---|---|
| firebase_gcp | Faturas e relatórios de uso do projeto comercial kyrub-b8d0e; identificar região, plano e créditos. | Firestore, Storage, Functions, Auth, tráfego e demais SKUs; conciliar créditos/descontos, separar homologação e outros projetos, não somar linhas de detalhamento e total da mesma fatura. |
| vercel | Fatura de assinatura e detalhamento de uso da conta/equipe do projeto. | Distinguir plano fixo, créditos e uso adicional; alocar custos compartilhados uma vez. Não somar estimativas do dashboard com fatura final. |
| other_infrastructure / providers | Faturas de domínio, e-mail, SMS, mapas, integrações e outros fornecedores efetivamente contratados. | A presença de integração não prova contratação/uso/custo. Registrar moeda e evidência de conversão efetiva. |
| operations / other_own_cost | Documentos de despesas da operação (suporte, pessoal, ferramentas, etc.). | Autorização, regime e competência, sem presumir zero. |
| tag_costs | Compras, frete, embalagem, estoque/custo dos itens vendidos. | Distinguir compra de estoque no caixa e custo de mercadoria na competência; evitar dupla contagem. |
| payment_fees / platform_incentives | Extrato/settlement do provedor e obrigações comprovadas do Kyrub. | Não deduzir taxa da receita e lançar novamente; não incluir subsídio de loja/parceiro ou remuneração de terceiro como custo próprio. |
| taxes | Documentos fiscais/contábeis autorizados. | Não inferir impostos por alíquota arbitrária; avaliar regime com contador. |

Kyrubia: server/kyrubiaUsageMetering.ts escreve estimativas por chamada generativa em kyrub_usage_events (micro-USD) e docs/AI_USAGE_GOVERNANCE.md descreve modelo anterior. Não representa fatura final. Diretriz atual: inteligência determinística do sistema, desativada no lançamento; não reativar LLM nem construir nova medição de tokens. Verificar futuramente ausência de chamadas externas no fluxo de lançamento, sem assumir custo zero.

## Denominador MAU
loadAdminDashboardMetrics conta documentos users, não usuários ativos. src/observability/kyrubActivityLog.ts mantém eventos locais limitados; src/observability/kyrubActivityRemote.ts envia lotes de 20, fila limitada de 80, com timestamp de cliente; server/observability/kyrubActivityTransport.ts autentica requisição e grava console.info com actorRef hash truncado, não armazena conjunto mensal completo. Não usar logs para declarar MAU exato: cobertura, retenção, perda de fila, período, deduplicação, origem e isolamento não comprovados. Risco específico: fila de módulo pode conter evento de conta anterior enquanto flush usa auth.currentUser atual e omite actorUid; revisar isolamento sem copiar identificadores pessoais para relatórios. 
Proposta de métrica: usuários autenticados únicos com pelo menos uma atividade qualificável recebida/validada pelo servidor no mês civil America/Sao_Paulo; excluir atividade técnica/sintética, diferenciar cadastro, visitante, sessão e MAU. Antes de criar um writer, inventariar métricas existentes e estimar custo, retenção, proteção contra abuso, reprocessamento e privacidade. Não inserir escrita Firestore por evento ou presumir cobertura completa. 

## Sequência de fechamento
1. Inventário read-only autorizado de contas/projetos e período fechado; sem tokens, dados de compradores ou identificadores individuais em relatórios.
2. Identificar fonte, escopo, moeda, natureza própria/terceiro, período e regime; reconciliar documento de fatura/extrato e linhas, IDs de fatos canônicos, estornos, créditos e rateio de despesas compartilhadas; excluir sandbox sem apagar histórico.
3. Atestar cobertura por categoria apenas quando completude, duplicidades e diferenças estiverem reconciliadas; parcial/indisponível nos demais casos. Não inventar zero, câmbio, faturamento, MAU, margem ou economia.
4. Alimentar projectPlatformFinops apenas com dados conciliados; regime caixa = fluxo operacional líquido, competência = resultado do escopo; não chamar lucro contábil sem fechamento contábil. Indicadores no Financeiro existente. 
5. Homologar dados sintéticos, acesso financeiro, reconciliação e período; depois aprovar acesso/integração de cada fonte. Sem serviço pago, exportação automática, alteração de IAM, regras, checkout, escrituras, merge ou deployment nesta etapa.
