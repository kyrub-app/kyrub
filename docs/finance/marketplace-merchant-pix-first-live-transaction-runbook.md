# Kyrub — primeira transação Pix do lojista (Matriz de homologação financeira)

**Status:** roteiro preparado, não executado. **PR alvo:** #956 (Draft). **Data:** 21/10/2026. **Modelo B:** vendas da loja → conta OAuth do lojista; assinatura Kyrub → conta da plataforma. Não copiar chaves de produção para previews.

## Condições de entrada obrigatórias
1. CI dos contratos, aplicativo, TypeScript, Phase 10 e preview do **HEAD exato** aprovados.
2. Revisão da PR #956 e aprovação específica de promoção em `main`; confirmação no domínio `kyrub.com` do SHA READY, sem alterar o link fixo de homologação para Pix.
3. Verificar conexão e pré-validação OAuth da loja; confirmar conta MP alvo por ID mascarado. Registrar beneficiário esperado *antes* do teste.
4. Confirmar pela operação da loja um único pedido de teste, valor total e descontos explicitamente aprovados. Não inventar produto ou valor; não criar pagamentos sem confirmação.
5. Para o **piloto inicial**, habilitar somente em **Production**: `KYRUB_MP_MERCHANT_PIX_ENABLED=true`, `KYRUB_MP_MERCHANT_PIX_ROLLOUT_MODE=canary` e `KYRUB_MP_MERCHANT_PIX_CANARY_STORE_ID=<id canônico da loja piloto>`. Variáveis ausentes, incorretas ou Preview devem bloquear novas emissões. Exigir redeploy/READY se alterar env de Vercel. Não publicar o ID em logs ou screenshots que não precisem dele. Após a validação completa e autorização expressa de expansão, configurar `KYRUB_MP_MERCHANT_PIX_ROLLOUT_MODE=connected_stores`: cada loja que possuir sua própria conexão OAuth válida poderá emitir seus Pix para sua própria conta, sem limitação permanente a uma loja e sem reutilizar o token de outras.
6. Se o checkout já tiver clientes reais ativos, planejar janela de migração; o gate desativado recusa novas emissões Pix, sem fallback para a conta da plataforma. Não liberar migração sem operação de suporte.
7. Confirmar segredo HMAC do webhook e rota operacional; não assumir que Pix gerado é Pix pago.

## Gate de continuidade operacional — obrigatório antes do merge

A versão atual da produção ainda tem o emissor legado para novos Pix da vitrine. A PR #956 remove essa emissão para vendas de lojas e **não** faz fallback para o Access Token da plataforma. Portanto, ativar `main` sem preparar as lojas pode interromper novas vendas Pix. Preview READY e CI verde não comprovam que todas as lojas estejam prontas.

Antes de aprovar promoção, a equipe autorizada deve conferir no ambiente real, **sem alterar dados ou exportar tokens**, e registrar de forma restrita:

1. Quantidade de lojas com vendas Pix recentes ou pedidos aceitos/pendentes, incluindo cobranças já emitidas e ainda não pagas (não presumir que exista somente a loja piloto).
2. Para cada loja ativa, seu identificador canônico, proprietário legítimo, estado de OAuth Mercado Pago **daquela loja**, pré-validação real de beneficiário e possibilidade de receber Pix — sem revelar credenciais. Sinal `connected` ou `live_preflight_required` isoladamente não prova aprovação do Mercado Pago.
3. Destino atual de novos Pix, quantidade de pedidos aguardando pagamento e responsável operacional. Se houver lojas ainda usando o checkout legado ou sem OAuth, definir migração e comunicação **antes** do merge.
4. Planos de cobrança da plataforma, PDV presencial, Pix já emitido, webhooks e conciliação devem permanecer funcionais. Reconciliar histórico mesmo após desativar a nova emissão.
5. A primeira compra real exige somente a loja piloto já autorizada e o gate `canary`. Não habilitar `connected_stores` até verificar que a ativação das demais lojas não interromperá vendas e que cada uma tem OAuth próprio.

### Matriz de impacto esperada

| Situação | Comportamento no novo código | Ação antes do lançamento |
|---|---|---|
| Pix antigo emitido, ainda em aberto | Reconsulta na conta que emitiu; não cria novo Pix | Conferir consultas, expiração e webhook |
| Loja do piloto, OAuth validado, canary ativo | Novo Pix na conta do próprio lojista | Uma transação real autorizada |
| Outra loja, mesmo com OAuth, canary ativo | Nova emissão bloqueada (503) | **Não promover para produção sem plano de continuidade** |
| Loja sem OAuth, modo `connected_stores` | Nova emissão bloqueada (409), sem fallback para a plataforma | Conectar e pré-validar a conta antes de aceitar novos pagamentos |
| Cobrança de assinatura Kyrub | Permanece no faturamento da plataforma | Validar regressão independentemente |

**Critério de parada:** se não houver inventário confiável das lojas ativas, se alguma loja ainda depender do emissor legado para novas vendas, ou se não existir janela de migração autorizada, manter PR #956 Draft e não realizar merge. Não prometer ausência de interrupção com dados desconhecidos e não religar a conta da plataforma como recebedora de vendas de outros lojistas para contornar o bloqueio.

O status `marketplacePixPreparation` exposto no cartão Recebimentos é **somente um diagnóstico de prontidão da configuração por loja**; nunca substitui consulta ao Mercado Pago, validação de identidade, Pix pago ou conciliação.

## Auditoria prévia de registros (uma loja, sem consultas financeiras mutantes)

O inventário já confirmou **uma loja publicada com vínculo OAuth registrado**, mas isso não comprova que não existam pedidos ou Pix anteriores. Consultar na produção com acesso autorizado, sem assumir valores ou fabricar histórico:

- Determinar o `storeId` canônico a partir da identidade da loja confirmada, nunca pelo nome exibido `Minha Loja` ou pelo número mascarado da conta. Para cada registro, conferir `storeId` e `orderId` antes de usá-lo.
- Pedidos operacionais: `artifacts/{storeId}/public/data/customerOrders/{orderId}`, distinguindo pedidos `pending`, aceitos/aprovados, pagos, cancelados e com pagamento expirado.
- Intenções: `stores/{storeId}/paymentIntents/{intentId}`, identificando `status`, `target.orderId`, `paymentId`, `providerIntentId`, `idempotencyKey` e expiração. Nunca expor dados sensíveis em capturas públicas.
- Pagamentos: `stores/{storeId}/payments/{paymentId}`, cruzando `paymentIntentId`, `providerPaymentId`, `status`, valor em unidades menores e timestamps.
- Para cada `providerPaymentId` existente, usar o vínculo de provedor já salvo para a consulta no **emissor original**; não reemitir Pix nem inferir a conta recebedora a partir do token atual.
- Registrar contagens por categoria (apenas totais agregados e IDs mascarados), quaisquer divergências entre pedido/intenção/pagamento e a necessidade de conciliação. Verificar casos com Pix aberto, pago sem webhook ou pedido pendente de aprovação.

**Critério de avanço:** ausência de registros antigos não pode ser presumida com base na contagem de lojas. A primeira emissão só é permitida após demonstrar consistência dos registros existentes, validar novamente o OAuth/beneficiário real e autorizar uma compra controlada. A revisão de recibos e webhooks após essa compra é uma etapa diferente; nenhuma consulta do inventário conta como liquidação.

## Matriz de validação

| Caso | Ação | Evidência exigida | Aprovação |
|---|---|---|---|
| 0. Ambiente não liberado | Tentar emissão sem canary ou em Preview (apenas contrato automatizado) | Erro `MERCADO_PAGO_STORE_PIX_ROLLOUT_NOT_ENABLED` / `MERCADO_PAGO_STORE_PIX_PRODUCTION_ONLY`, sem POST ao provedor ou gravação do snapshot | [ ] |
| 1. Loja sem OAuth válido | Validar condição bloqueada em teste automatizado | Erro 409; nenhuma emissão com credencial da plataforma | [ ] |
| 2. Pedido pendente | Criar/consultar pedido aguardando aceitação | Sem Pix, QR ou alteração de status financeiro | [ ] |
| 3. Pedido aprovado | Aprovar somente pedido teste escolhido | Mesmo paymentIntent, pedido e snapshot comercial; valor e cupom conferidos | [ ] |
| 4. Beneficiário | Antes do POST `/users/me`, após resposta `collector_id` | Ambos coincidem com conta OAuth e autoridade canônica esperadas; não basta apenas status “conectado” | [ ] |
| 5. Emissão única | Gerar Pix controlado autorizado | Um providerPaymentId, QR, idempotency key do intent e valores corretos; nenhuma taxa/split da plataforma | [ ] |
| 6. Reentrada | Voltar à tela/clicar novamente com mesmo pedido | Mesmo providerPaymentId e recebedor; não emitir segundo Pix | [ ] |
| 7. Liquidação | Pagar uma única vez usando conta pagadora autorizada | Status `approved` no MP, HMAC válida e um evento deduplicado; nunca concluir pago só por QR gerado | [ ] |
| 8. Pedido e estoque | Conferir após webhook | Pedido `paid` uma vez; baixa/reserva, custo/CMV e margem compatíveis com o pedido | [ ] |
| 9. Financeiro Interno | Conferir competência mensal, caixa, recebíveis/conciliação | ID do pagamento corresponde ao pedido; bruto, taxas MP, líquido e destino de recebimento consistentes; sem lançamento duplicado | [ ] |
| 10. Reembolso/cancelamento (se autorizado) | Fluxo posterior sob autorização separada | MP, pedido, estoque, CMV, caixa e margem reconciliados com histórico preservado | [ ] |
| 11. Pagamentos antigos | Reabrir apenas um Pix histórico conhecido | Consulta na credencial original; nunca remintar nem trocar beneficiário | [ ] |

## Evidência mínima e parada
Registrar (em local autorizado e com dados pessoais mascarados) SHA/deployment, storeId canônico, ID recebedor, orderId, paymentIntentId, paymentId, providerPaymentId, totais, horários, status do webhook e resultado do razão/conciliador. Não registrar Access Token, Client Secret, chave Pix, payload de credenciais ou dados pessoais completos em issues públicas.

**Abortar** diante de identidade divergente, collector ausente, segundo providerPaymentId, webhook não autenticado, valores incorretos, lançamento duplicado ou pagamento órfão. Não repetir o POST cegamente: investigar no Mercado Pago pelo idempotency/external_reference, conservar a evidência e somente então prosseguir.

## Desativação / rollback
- Parar novas emissões removendo/desabilitando a variável de liberação no ambiente certo e confirmar deployment READY; não revogar OAuth da loja.
- Nunca desfazer lançamentos financeiros por simples rollback de código. Pix já emitidos precisam manter consulta via vínculo original e webhook/reconciliação disponíveis.
- A canary de uma loja é apenas a fase inicial. Para expandir, concluir a matriz e aprovar explicitamente a alteração para `connected_stores`; o próprio vínculo individual OAuth de cada loja continua obrigatório para receber. Não há conta recebedora, token ou extrato financeiro compartilhado entre lojas.
