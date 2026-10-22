# Marco de auditoria Pix por loja — histórico e novas operações

## Contexto validado em 21/10/2026 (horário do Brasil)
Consulta administrativa somente leitura da PR #960, no domínio admin.kyrub.com, após deployment READY do commit 250e20a97ca437b33dc61e84d586978d8160ff72.

Inventário: uma loja publicada, sem truncamento; OAuth registrado, conta exibida apenas com final 6959; rollout desativado.

Contagens observadas (não representam valores financeiros nem transações únicas):
| Origem | Total | Pendentes | Pagos | Outros |
|---|---:|---:|---:|---:|
| customerOrders | 5 | 1 | 3 | 1 |
| paymentIntents | 2 | 1 | 0 | 1 |
| payments | 4 | 1 | 0 | 3 |

O operador informou que as operações anteriores são predominantemente testes e podem incluir pedidos não pagos ou excluídos da interface. Essa informação **não comprova** que cada registro seja um teste. Não excluir, reclassificar, reconciliar artificialmente nem alterar estados.

## Política para o novo período
1. Manter os registros anteriores visíveis como histórico, sem bloquear a migração apenas por divergências agregadas entre coleções.
2. **Ainda não há corte temporal persistido.** Antes de qualquer novo checkout Pix, estabelecer um marco imutável por loja, com timestamp de servidor e identificação do deployment/versão, em trilha administrativa auditável. Não usar a hora da leitura deste documento como corte operacional.
3. Cada operação posterior ao marco deve ter ID idempotente, vínculo inequívoco com loja/pedido/intenção/pagamento, estado e timestamps do servidor.
4. A reconciliação com Mercado Pago deve verificar pagamento, valor/moeda, estado, identificador do provedor e recebedor efetivo. OAuth cadastrado e sufixo da conta **não** comprovam o beneficiário de uma transação.
5. Registros sem timestamps confiáveis ou vínculos inequívocos devem permanecer em grupo `origem_indeterminada`, não serem classificados automaticamente como novos ou antigos.
6. Continuar respeitando Modelo B: vendas do lojista em sua conta MP; assinatura Kyrub em conta da plataforma.
7. PR #956 continua Draft, sem merge. Nenhuma cobrança real, ativação de rollout ou troca de credenciais é autorizada por este documento.

## Gates para implementação
- [x] Confirmar produção da PR #960 e consultar contagens por loja
- [x] Documentar contexto e separar conceitualmente histórico de novos registros
- [ ] Definir e persistir marco imutável por loja com autorização administrativa
- [ ] Exibir contagens separadas com tratamento de timestamp ausente e paginação completa
- [ ] Conferir beneficiário e situação no provedor sem efeitos financeiros
- [ ] Validar testes, CI, preview fixa e somente então deliberar sobre #956
