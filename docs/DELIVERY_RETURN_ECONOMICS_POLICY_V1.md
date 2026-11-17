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

## Extensão v1.1 — revisão independente da responsabilidade inicial

A PR acrescenta `deliveryReturnLiabilityReviews/{deliveryId}` com os estados
`awaiting_independent_review`, `needs_more_evidence` e
`approved_no_financial_execution`; cada proposta possui versão, impressão
digital da confirmação física e evento imutável em
`deliveryReturnLiabilityReviewEvents`. O preparador não pode aprovar a
própria classificação; uma modificação da confirmação física invalida a
aprovação, e as reaberturas mantêm histórico de versões.

A classificação de causa `store_failure`, `platform_failure`,
`recipient_absent`, `safety_incident`, `courier_conduct_alleged`,
`damage_or_missing` ou `undetermined` só sugere uma fonte *inicial* de
custeio. Em caso de embalagem danificada/divergente, o custo fica
`disputed` independentemente do motivo. Sem débito do entregador ou
consumidor. A aprovação significa **triagem independente**, nunca
responsabilidade civil definitiva nem obrigação de pagar.

A fila de suporte exibe formulário e estado da revisão dentro da consulta
econômica. Os endpoints de leitura, proposta e decisão reaproveitam a rota
`/api/delivery-opportunities`, com Firebase Auth, papéis administrativos
ativos e transações idempotentes. Nenhuma tarifa é presumida, e o retorno
continua sem valor financeiro definido até a existência de contrato
versionado aceito no momento da contratação.

## Extensão v1.2 — prévia de tarifa contratual, sem execução

O cálculo numérico de retorno e espera ao destinatário somente retorna uma
**prévia**, em centavos inteiros, quando três fontes independentes estiverem
disponíveis no servidor:

1. `deliveryClaims/{deliveryId}.returnTariffAcceptedTerms` — contrato
   versionado, com `acceptedVia=server_courier_claim`, data de aceite,
   mesmo entregador e mesma entrega. A escrita desse aceite ainda **não foi
   habilitada na interface**.
2. `deliveryReturnProtocols/{deliveryId}.independentReturnDistanceAuthority`
   — distância autorizada por planejamento de rota independente, não GPS
   unilateral do entregador. O emissor/validador dessa evidência ainda
   **não foi implementado**.
3. `deliveryReturnProtocols/{deliveryId}.recipientWaitingCorroboratedInterval`
   — janela de chegada e liberação corroborada pelo servidor, não apenas
   um cronômetro visual. A materialização dessa evidência ainda depende de
   homologação operacional.

Sem as fontes, a parcela permanece `null`/“Não apurado”. Com elas, aplica-se
`max(piso, ceil(distancia_metros × centavos_por_km / 1000))`. A espera
somente começa depois da cortesia contratada, por incrementos e teto,
respeitando limite operacional (excedente exige revisão). O resultado
**nunca** altera `totalRecognizedMinor: null` nem torna a despesa
elegível, porque dependem de avaliação econômica independente, condições
do consumidor e uma fonte de financiamento.

Nenhum valor numérico de preço foi fixado para lançamento; os exemplos
de testes não são tarifa oficial. O modelo aceita políticas futuras sem
reajustar termos de trabalhos anteriores.

## Bloco técnico v1.3 — aceite e janela de espera com prova corroborada

- Uma política publicada em `platformEconomicPolicies/deliveryRecipientReturnTariff`
  é opcional e só participa de **novas ofertas** se contiver `enabled: true`,
  valores em centavos, versão, data `effectiveFrom` e limites válidos.
  **Nenhuma tarifa oficial foi cadastrada por este desenvolvimento.**
- A oferta nova guarda `returnTariffOfferSnapshot` com impressão SHA-256
  dos termos. Sua projeção pública traz somente preços e versão, sem
  endereço do comprador. O entregador marca concordância expressa na
  lista de ofertas. O aceite da rota e dos termos ocorre na **mesma
  transação** que grava `deliveryClaims`, com UID, horário do servidor
  e fingerprint. Não há assinatura retroativa ou recálculo pelo preço
  global vigente depois do aceite.
- O instante de chegada declarado pelo entregador continua **não sendo,
  sozinho, comprovação de tempo remunerável**. O backend agora captura
  avaliação atual e positiva do geofence do destinatário, realizada pelo
  servidor, com precisão de até 100 m e janela de 90 s, quando disponível.
  Se a logística autorizar o retorno após contato e solicitação de
  análise, o intervalo até a autorização pode ser registrado como
  `recipientWaitingCorroboratedInterval`. A autorização exige operador
  responsável e registra seu horário no servidor. Não se considera que
  o destinatário foi contatado apenas pelo relato do entregador.
- Sem geofence corroborado, com evidência antiga ou em entregas legadas,
  a espera permanece `null`/não apurada, não zero. A prévia é informativa;
  mesmo com geofence e tarifa aceita, **nenhuma obrigação, pagamento ou
  reembolso é criado ou liberado**.

**Pendente:** obter distância de retorno calculada por um provedor de rotas
autorizado no servidor e vinculada à loja original; validar fisicamente
GPS, consentimento e capacidade do suporte; revisar custos e direitos do
consumidor antes de lançamento. Operação real continua não autorizada.

## Bloco técnico v1.4 — distância independente e controle de custos

A rota de volta passa a contar com uma verificação sob demanda, via Google
Routes API `computeRoutes`, com máscara exclusiva
`routes.distanceMeters`. O servidor lê a posição do destinatário do
snapshot georreferenciado canônico, a loja original do registro privado
e a modalidade efetivamente aceita no claim. Para bicicleta/moto utiliza
`BICYCLE`/`TWO_WHEELER` (beta e sujeitos a disponibilidade regional),
e para carro `DRIVE`. Não aceita distância enviada pelo navegador, GPS
do entregador ou endereço livre na requisição.

**Portão de segurança e custo:** `platformEconomicPolicies/deliveryReturnRouteVerification`
deve existir com `enabled: true` e `maxDistanceMeters` entre 1 e 200000.
Sem isso, nenhuma chamada paga é realizada. A credencial Google permanece
no repositório criptografado da plataforma. A consulta é manual, por operador
autorizado **diferente daquele que autorizou o retorno**, após confirmação
física da loja, contrato tarifário aceito e origem/destino válidos.
A interface pede confirmação e informa que pode haver custo do provedor.
Nenhuma API Maps foi acionada na implantação deste código.

O resultado traz apenas a distância planejada, modo, identificador
determinístico e auditoria; não registra trilha GPS nem prova trajeto
real. A transação revalida a mesma rota, loja, política, protocolo e
entregador antes de gravar `independentReturnDistanceAuthority`.
Repetições do mesmo resultado não criam outro evento; conflitos
suspendem a apuração. O valor continua uma **prévia sujeita a revisão**,
não pagamento. Testes de adapter com resposta falsa não fazem requisições
a Google.

Para ativação operacional futura: autorização explícita de custos
Maps/Routes, credencial com escopo apropriado, revisão de privacidade
para envio de coordenadas ao provedor, suporte às modalidades e
homologação mobile com GPS real. Nenhuma tarifa é publicada por
esta alteração.
