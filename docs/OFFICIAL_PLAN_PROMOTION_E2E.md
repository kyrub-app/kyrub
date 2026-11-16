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
