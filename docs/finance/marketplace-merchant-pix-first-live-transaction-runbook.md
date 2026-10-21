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
