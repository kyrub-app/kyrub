# Kyrub Entregas — Política Econômica de Ocorrências e Devoluções v1.0

**Estado:** proposta inicial de produto aprovada para desenvolvimento em 17/11/2026.
**Vigência comercial:** não ativada. **Execução financeira:** bloqueada.
**Integração prevista:** PR #1145, sem merge/deploy de produção.

## Princípio

A atividade comprovada do entregador pode gerar remuneração mesmo sem entrega
ao comprador. Reconhecer trabalho, determinar o responsável pelo custo e
decidir um reembolso são **três procedimentos diferentes**.

Uma autorização de retorno, uma declaração de chegada ou uma confirmação de
custódia não movimentam dinheiro, não constituem ordem de débito ao comprador,
não provam responsabilidade por avaria e não liquidam obrigação financeira.

## Situações operacionais e tratamento inicial

| Situação | Diretriz para remuneração | Evidência / liberação |
| --- | --- | --- |
| Cancelamento antes de saída para coleta | Sem remuneração por deslocamento não realizado | Conferir estado, horário e aceite |
| Entregador saiu para coleta, loja fechada / cancelou | Avaliar trecho comprovado conforme contratação | GPS recente e ocorrência confirmada; revisar autoria |
| Pedido coletado, rota interrompida | Analisar rota realizada e retorno autorizado separadamente | Coleta, motivo, suporte e custódia |
| Destinatário ausente após chegada | Analisar remuneração original integral conforme contrato; retorno adicional se autorizado | Chegada, tentativas, revisão humana, retorno |
| Espera superior à tolerância contratada | Avaliar adicional conforme tarifa e limite previamente aceitos | Evidência temporal, segurança e fonte tarifária |
| Loja recebeu a devolução | Encaminhar conciliação das parcelas, **não** criar pagamento | Confirmação do titular da loja e condição física |
| Avaria, divergência ou extravio | Disputa de responsabilidade; não descontar ganho automaticamente | Revisão humana independente |

**Segurança:** em ameaça, acidente ou risco físico, o entregador pode pedir
suporte imediatamente; não é necessário aguardar prazo de cortesia.

## Provisão e responsabilidade inicial

| Causa corroborada | Financiamento/encaminhamento inicial |
| --- | --- |
| Falha do lojista: loja fechada, separação errada, endereço fornecido incorretamente | Lojista, sujeito a contrato e revisão |
| Falha comprovada de despacho, duplicação ou sistema Kyrub | Kyrub |
| Destinatário ausente | Contratante/loja inicialmente; eventual recuperação do consumidor somente quando legal e contratualmente permitida |
| Segurança, acidente, ameaça | Contingência operacional, pendente de classificação |
| Conduta comprovadamente atribuída ao entregador | Revisão individual, sem desconto automático |
| Avaria ou extravio de autoria desconhecida | Contestação, preservação de evidências e suspensão das parcelas controvertidas |

A causa deve ter identificador, fonte, evidências, justificativa e revisor.
Nada deve ser atribuído automaticamente a partir de relato unilateral ou GPS
isolado. Valores incontroversos podem seguir para a análise de elegibilidade
sem aguardar a resolução de outras parcelas, **se** houver autorização e
mecanismo antifraude comprovados.

## Quatro componentes financeiros independentes

1. **Rota original:** fonte canônica do ERP / captura de pagamento e condições aceitas; não usar valor exibido pela interface como autoridade.
2. **Retorno:** distância autorizada da volta, tarifa e piso contratados; identificador próprio, distinto da rota original.
3. **Espera:** evento temporal válido, prazo de cortesia, tarifa por incremento e limite; identificador próprio; não reutilizar obrigação de espera na loja como espera no destinatário.
4. **Reembolso do comprador:** pedido e direitos do consumidor, separado da remuneração do entregador. O direito de arrependimento, defeito, descumprimento de oferta, erro e ausência do destinatário exigem classificações diferentes.

Um pagamento de compra não é fonte suficiente para criar automaticamente
múltiplos pagamentos de entregador. Toda parcela exige identificador único,
base financeira, origem, estado, beneficiário, responsabilidade, revisão e
verificação de inexistência de quitação prévia.

## Parâmetros propostos (sem tarifa ativa)

| Parâmetro | Diretriz inicial |
| --- | --- |
| Cortesia ao destinatário | 10 minutos, somente se seguro e contratualmente previsto |
| Taxa por quilômetro do retorno | Preferir tarifa aceita para a viagem, **sem valor numérico definido** |
| Valor mínimo de retorno | Definir com custos reais e previsão contratual |
| Adicional de espera | Por incremento e teto; **sem valor numérico definido** |
| Máximo de espera operacional | Configurável; tempo imposto após o limite exige revisão e remuneração |
| Responsabilidade do custo | Revisão humana e vínculo contratual, nunca cobrança surpresa |
| Renovação/alteração da política | Versionar; não recalcular entregas passadas sob termos novos |

Os R$ 12,00 de entrega, R$ 6,00 de retorno, R$ 1,00 de espera e R$ 19,00
de total utilizados no planejamento são **meramente ilustrativos**.

## Fluxo previsto no Control Plane

1. Receber o protocolo físico de retorno `returned_to_store_pending_reconciliation`.
2. Consultar o préflight econômico **somente leitura**, com fonte financeira e
   quatro componentes independentes; exibir “Não apurado” para valores não confirmados.
3. Apurar espera, distância e preço do retorno a partir dos termos vigentes na
   data do aceite (ainda falta implementar esse contrato).
4. Classificar responsabilidade financeira com justificativa e evidência.
5. Garantir revisão independente, idempotência e bloqueio de obrigações elegíveis
   ou já liquidadas antes de qualquer liberação.
6. Executar cobrança/repasse/reembolso **em serviços específicos e autorizados**,
   após homologação, não pelo protocolo de devolução.

## Implementação técnica inicial

- `shared/deliveryReturnEconomicPolicy.ts`: modelo de quatro componentes, IDs
  distintos e indicadores de bloqueio por duplicidade.
- `server/delivery/deliveryReturnEconomicReviewService.ts`: prévia server-side
  que valida papel administrativo, recibo físico, claim, origem do pedido e
  fonte de captura canônica.
- Endpoint `GET /api/delivery-opportunities/admin/returns/:deliveryId/economic-preflight`
  dentro do roteador **existente**, sem nova função Vercel.
- `AdminDeliveryReturnEconomicsPreview` na fila de suporte do Control Plane.
- Testes de contrato no `prebuild` existente.

A prévia não grava no Firestore, não cria `economicObligations`, não muda
status do pedido, não reembolsa e não efetua pagamento. O total fica nulo
enquanto as parcelas e a responsabilidade não estiverem comprovadas.

## Critérios de liberação comercial

- Contrato tarifário de retorno/espera aceito e versionado no servidor.
- Políticas de direitos do consumidor revisadas juridicamente.
- Fluxo de revisão humana, disputas, avaria e custódia física homologado.
- Antiduplicação de obrigações e rechecagem transacional de fontes.
- Testes com Firebase Emulator e navegação móvel autenticada, GPS real e
  presença de operador/loja.
- Privacidade do endereço exato da rota, SLA operacional e custos de mapas
  resolvidos na PR #1145.
- Aprovação independente antes de integrar à produção.

**Fora de escopo da v1 inicial:** ativar taxas, cobrar compradores, lançar
descontos, liquidar ganhos, publicar regras comerciais definitivas ou criar
um mecanismo de repasse automático.
