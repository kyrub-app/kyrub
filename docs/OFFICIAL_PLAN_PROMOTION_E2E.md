# E2E terceiro usuário — integração promocional oficial (isolada)

## Estado comprovado
- #1122 integrada: Praça -> `/@slug?coupon=CODE` -> carrinho B2C, não checkout de planos oficiais.
- #1110 integrada: vigência do plano a partir da confirmação do Pix; preservar regra.
- #1137 aberta: bônus 100 Pitangas e conversão 1000:1 aguardam atestação de escritores; não habilitar.
- #1138 (esta PR): cotação pura de cupom Business, sem alteração de checkout, cobranças ou produção.

## Lacuna de integração e invariantes
`quoteOfficialPlanPix` recebe loja/produto/meses, e `offer()` calcula `quote.totalMinor` pelo catálogo autoritativo. `acceptOfficialPlanPix` exige `acceptedTotalMinor === d.offer.quote.totalMinor`. `checkoutOfficialPlanPix` reconfirma a oferta e envia exatamente `d.offer.quote.totalMinor` ao provedor; `validatePayment` compara esse mesmo valor. Os registros financeiros também usam esse total.

**Não substituir somente o valor enviado ao provedor**: isso quebraria o vínculo entre aceitação, pagamento, contrato e ledger. Para aceitar cupom oficial será necessário um único snapshot de preço final assinado/digerido pelo servidor e propagado consistentemente por todas essas etapas.

## Integração futura, sem habilitar produção
1. Aceitar `promotionId` ou código apenas como referência; resolver no servidor contra `stores/{officialStoreId}/promotions`, confirmar loja/produto oficiais, janela, elegibilidade e limites. O UID vem do token.
2. Calcular preço-base autoritativo e desconto com `quoteOfficialPlanPromotion`; manter preço-base e valor final separados no snapshot imutável, vinculados a `offerDigest`.
3. No aceite e na reserva transacional, revalidar cupom e limites por comprador, impedir concorrência e consumo duplicado, com referência determinística ao checkout. Nunca consumir cupom por simples visualização.
4. Enviar somente o total aceito ao provedor simulado; validar o mesmo valor no callback, contrato, pagamento, ledger, CRM e entitlement. Replays não podem consumir cupom novamente.
5. Executar no emulador: terceiro UID fictício, publicação da loja -> 2 XP, Praça -> cupom Business -> quote R$ 1,00 -> aceite -> Pix simulado -> contrato e benefício vigentes no instante da confirmação; replays e concorrência sem duplicação.
6. Falhas obrigatórias: cupom vencido, esgotado, outra loja/produto/UID, mudança entre quote e aceite, pagamento divergente, reuso e disputa de último resgate.

## Gates que permanecem
O piloto financeiro real atual permite somente Pro mensal integral; não expandir para Business ou descontos sem revisão independente e autorização. `KYRUB_OFFICIAL_PLAN_PIX_CHECKOUT_ENABLED` continua desligada; não mexer em credenciais, `writersVerified`, Pitangas, XP ou dados reais. Esta PR não deve ser mergeada nem publicada por sua existência. A função de cotação pura não autoriza emissão nem comprova o E2E.

## Origem obrigatória do cupom — ERP da Loja Oficial
O Control Plane publica **desafios globais** (por exemplo, primeira publicação da loja -> 2 XP), não cupons comerciais. O cupom Business deve ser criado no gerenciador `StorePromotionsManager` do ERP da Loja Oficial, persistido por `storePromotionManagementRouter` em `stores/{officialStoreId}/promotions/{promotionId}` e compartilhado na Praça pela função já existente da PR #1122.

O novo leitor somente-consulta `quoteOfficialPlanPromotionFromErp` verifica a designação `kyrub_admin/official_store` antes de buscar a promoção no ERP e calcular a cotação. Não aceita cupom avulso fornecido pelo navegador nem cria outro catálogo promocional no Control Plane. O leitor ainda não está ligado ao endpoint de checkout; não reserva nem consome cupom.

**Atenção:** a vitrine pública passa `?coupon=CODE` ao carrinho B2C, enquanto o leitor oficial recebe `promotionId`. A futura integração precisa resolver o código contra os cupons do ERP, validar unicidade e elegibilidade no servidor e encaminhar o usuário para o checkout de plano oficial. Não tratar o carrinho genérico como checkout de plano.

## Reserva transacional experimental (PR #1138)
`reserveOfficialPlanPromotionForCheckout` é uma função isolada que usa transação Firestore para ler a promoção do ERP e criar uma reserva por `checkoutId` determinístico. Mantém `reservedCount` na promoção e contagem por comprador, impedindo que reservas simultâneas ultrapassem os limites. Uma chamada idêntica retorna `already_reserved`, sem duplicar contadores. O leitor público atual considera apenas `redemptionCount`; portanto, disponibilidade mostrada na Praça pode diferir da disponibilidade efetiva durante uma reserva concorrente. A transação é a autoridade.

**Não está pronta para ser usada no checkout real:** falta vincular a reserva ao aceite assinado, expiração/liberação segura de reservas abandonadas, conversão idempotente de `reservedCount` para `redemptionCount` após confirmação de pagamento, validação do pagamento pelo provedor simulado e testes concorrentes em Firebase Emulator. Sem essas etapas, o contador de reservas poderia bloquear cupons indefinidamente. Não conectar este helper a produção antes de fechar o ciclo de vida.

## Finalização experimental da reserva
`finalizeOfficialPlanPromotionReservation` agora contém duas transições transacionais idempotentes: `reserved -> redeemed` exige checkout persistido como `activated` ou `paid_pending_activation`, com pagamento vinculado e valor aceito igual ao valor reservado; `reserved -> released` exige checkout persistido em estado terminal não pago (`expired`, `cancelled`, `rejected`). Em ambos os casos, atualiza contadores globais e por comprador, sem reutilizar reservas finalizadas.

**Limite conhecido:** o checkout oficial ainda grava o preço integral em `offer.quote.totalMinor`; por isso, o resgate Business R$1 **não será aceito** até a integração segura do snapshot promocional ao checkout. Não interpretar a existência do helper como E2E aprovado. Reservas expiradas não são liberadas automaticamente; precisam de confirmação terminal persistida e de um reconciliador específico. Não permitir que um cron libere Pix pendente ou resultado desconhecido.

## Ponte de valor da oferta canônica (sem execução de Pix)
`resolveOfficialPromotionalCheckoutAmount` compara o preço total original do catálogo oficial com o snapshot imutável aceito do cupom ERP. Para o piloto mensal Business: 39.700 centavos originais, 39.600 centavos de desconto, 100 centavos pagáveis. O teste `official-plan-promotion-checkout-amount.test.ts` cobre valor correto e divergências de comprador, produto, prazo, preço, desconto e valor informado pelo provedor.

**Não está integrado ao checkout de produção.** `officialPlanPixCheckout.ts` continua deliberadamente restrito ao piloto Pro sem desconto e sem aceitação de Business R$1. A próxima integração precisa ser limitada ao Firebase Emulator, com simulação de pagamento sem chamada ao Mercado Pago, e só depois de testes transacionais poderá ser avaliada para produção. Não alterar `allowPilotOffer` para liberar Business em produção.

## Verificador Pix simulado isolado
`verifyIsolatedOfficialPlanPromotionPix` exige `FIRESTORE_EMULATOR_HOST` em localhost/127.0.0.1 e flag explícita `true`. Valida o identificador de checkout, vínculo ao comprador, BRL/Pix, status aprovado e valor de 100 centavos contra o snapshot do Business mensal. O módulo é puro e **não grava contratos, não chama Mercado Pago e não autoriza concessão de benefícios**. Os testes unitários verificam rejeição de execução não isolada, pagamento pendente, valor diferente e identidade divergente.

Pendente: conectar cotação/reserva/simulação/finalização ao fluxo de checkout no Firebase Emulator, criar contrato fictício e validar os efeitos no entitlement. Não usar retorno desse verificador como comprovante real de pagamento.

## Teste encadeado de regras comerciais (não E2E Firebase)
`tests/official-plan-promotion-commercial-chain.test.ts` encadeia cotação do cupom do ERP, snapshot aceito de R$1, verificação do valor e confirmação Pix fictícia aprovada, rejeitando a tentativa de cobrar R$397. A configuração de isolamento é lida do ambiente do servidor e restaurada após o teste. Este teste **não acessa Firestore Emulator**, não executa a interface, não cria contrato nem concede Business. É validação unitária integrada dos módulos puros, não evidência de E2E.

## Vínculo obrigatório da reserva ao checkout
A reserva agora lê `plan_pix_checkouts/{checkoutId}` **dentro da mesma transação Firestore**, exige `checkoutId` hexadecimal de 64 caracteres, `buyerId`, loja, produto e preço original iguais aos dados do checkout e estado `quoted` ou `accepted`. Exige também `promotionAcceptedTerms` persistido e seu digest válido, com desconto e total iguais à cotação atual do ERP. Isso evita que um identificador arbitrário reserve o cupom sem uma oferta persistida.

**Dependência ainda não atendida:** o checkout atual não grava `promotionAcceptedTerms`, portanto a reserva falha fechada até que a integração isolada passe a persistir o snapshot no checkout. A ordem de integração deve ser cotar oferta oficial -> persistir aceite promocional validado -> reservar no mesmo contexto transacional/fluxo -> simular Pix -> reconciliar -> conceder contrato e consumir cupom. Nenhuma dessas alterações deve abrir o piloto Business no provedor real.

## Persistência do aceite promocional no checkout (somente emulador)
`attachIsolatedOfficialPromotionToCheckout` é um adaptador interno que exige `FIRESTORE_EMULATOR_HOST` local e `KYRUB_OFFICIAL_PROMOTION_ISOLATED_PIX_TEST=true`. Ele consulta o checkout oficial persistido, exige mesmo comprador, status `quoted`, oferta consistente e designação da Loja Oficial. Na transação Firestore, lê a promoção criada no ERP, recalcula a cotação canônica e persiste `promotionAcceptedTerms` com digest. Repetição com mesmo snapshot é idempotente; divergência falha fechada. Não é endpoint público, não cria cobrança, não ativa Business.

A reserva pode agora encontrar o snapshot esperado em checkout fictício do emulador. Ainda faltam testes Firebase Emulator de ponta a ponta, integração de um checkout isolado que consuma esses módulos e criação do contrato/entitlement simulado. O checkout real permanece sem suporte a cupom Business.
