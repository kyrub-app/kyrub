# Kyrub Entregas — navegação, GPS e requisitos de veículo

## Contrato técnico de navegação

Este documento descreve a integração da PR #1145. A referência técnica é o pedido e o aceite canônico do servidor, nunca a opção selecionada anteriormente no mural.

1. **Aceita**: rota para o endereço da coleta. **Em entrega**: rota para o endereço do comprador, somente após o handoff seguro de retirada.
2. O veículo vem de `hub/renda/deliveries/{id}.vehicleType` (definido pelo servidor durante o aceite). Se não houver veículo confirmado ou o destino for marcador/placeholder, **não** se fabrica uma rota.
3. Google Maps externo: bicicleta = `bicycling`; moto = `two-wheeler`; carro = `driving`. `dir_action=navigate` solicita navegação ou prévia conforme disponibilidade. Não se informa origem fictícia: o Google Maps usa a localização do aparelho.
4. Links externos funcionam sem `VITE_GOOGLE_MAPS_API_KEY`. A chave é usada apenas no mapa incorporado de localização. O Kyrub ainda não oferece navegação turn-by-turn interna nem cálculo verificável de ETA.
5. **Somente o entregador atribuído** recebe o link acionável na superfície de rastreamento. Comprador/lojista veem mapa de posição autorizada, sem um botão que simule navegação do entregador.

Fontes Google: https://developers.google.com/maps/documentation/urls/get-started e https://developers.google.com/maps/documentation/routes/coverage-two-wheeled?hl=pt-BR (o Brasil é listado para `two-wheeler`). A disponibilidade de rotas individuais continua a critério do Maps.

## Posição, retomada e privacidade

- Rastreio por `navigator.geolocation.watchPosition` somente mediante consentimento de localização e entrega atribuída ao UID autenticado. `MIN_SEND_INTERVAL_MS=5000`; coordenadas precisas não são persistidas em `localStorage`.
- Coordenadas são publicadas no endpoint autenticado `/api/delivery-tracking/:deliveryId/location`, na coleção privada `deliveryTracking`; autorização de leitura fica restrita à loja, comprador e entregador.
- O backend não devolve uma localização como ativa se seu `updatedAt` de servidor for anterior a **90 segundos**; isso evita apresentar GPS parado como \"ao vivo\". Um timestamp inválido ou muito no futuro também falha fechado.
- `PERMISSION_DENIED` interrompe `watchPosition`, remove a seleção de rastreio do cache e solicita parada ao servidor. Falhas de rede ainda podem manter a última coordenada até a expiração automática de 90 segundos.
- Abrir navegação no Google Maps pode suspender a aba do navegador móvel, interrompendo o envio de posições: **não prometer rastreio contínuo em segundo plano** sem teste em Android/iOS e estratégia nativa apropriada.

## Conformidade para transporte remunerado

A classificação genérica `motorized_courier` e CNH/EAR **não** substituem a habilitação e autorização de motofrete. A legislação federal e requisitos estaduais/municipais precisam ser verificados por revisão humana antes de habilitar corridas remuneradas de moto.

Referências oficiais:
- Lei 12.009/2009 (texto atualizado, Câmara): https://www2.camara.leg.br/legin/fed/lei/2009/lei-12009-29-julho-2009-589965-normaatualizada-pl.html
- Resolução CONTRAN 943/2022 (segurança do motofrete, em vigor na lista SENATRAN): https://www.gov.br/transportes/pt-br/assuntos/transito/conteudo-contran/resolucoes/Resolucao9432022.pdf
- Curso especializado de motofretista, Resolução CONTRAN 930/2022, conferir vigência e alterações: https://www.gov.br/transportes/pt-br/assuntos/transito/conteudo-Senatran/resolucoes-contran
- Resumo oficial do DNIT: https://www.gov.br/dnit/pt-br/noticias-periodo-eleitoral/motofretista-e-mototaxista-o-que-diz-a-lei/

Revisão humana deve abranger, conforme legislação e localidade: idade mínima e tempo de habilitação A; curso especializado e reciclagem; registro/autorização do veículo na categoria de aluguel, equipamentos específicos, inspeção periódica, regras de acondicionamento da carga e exigências locais. As obrigações podem variar; não interpretar esta lista como certidão de conformidade.

### Motofrete — fluxo humano de atestação implementado na PR #1145

A avaliação especializada foi adicionada ao **mesmo documento privado de identidade**
`identity_verifications/{uid}.motofreteQualification`, sem cadastro paralelo:

1. Um usuário com identidade e perfil `motorized_courier` aprovados solicita motofrete na central de verificação. Anexa em caminhos privados `identity-verification/{uid}/document/*` evidências de curso, veículo/autorização, inspeção, equipamentos e, quando aplicável, autorização local. Documentos já anexados podem ser reutilizados na ressubmissão; nunca há aprovação automática.
2. O Control Plane mostra as evidências aos revisores com papel **Compliance** ou **Super Admin**. A equipe deve conferir as seis verificações explicitamente e fornecer uma validade futura de no máximo **180 dias** por política operacional conservadora — o limite não é uma declaração de prazo legal único.
3. A regra Firestore exige `reviewedBy == request.auth.uid`, `reviewedAt == request.time`, todos os critérios verificados e `validUntil > request.time` e `<= request.time + 180 dias`. O cliente só pode enviar nova solicitação; não pode criar atestação, alterar aprovação, validade, documentos em revisão ou revogar.
4. O revisor pode solicitar correções mantendo outras atividades aprovadas; pode também **revogar a atestação** após aprovação, registrando motivo e responsável sem modificar `approvedProfiles` original.
5. `courierVehicleDocumentEligibility` exige, na aceitação transacional do pedido, a atestação vigente, a CNH categoria A e EAR verificados; aprovação genérica `motorized_courier` não libera moto.

**Risco residual de auditoria:** o registro guarda `reviewedBy`, `reviewedAt` e motivo da **última decisão**, não um histórico imutável de todas as decisões anteriores. Para liberação comercial ampla, avaliar um livro de auditoria append-only com evidência versionada e retenção conforme LGPD.

## Pendências para liberação comercial

- Atestação administrativa de motofrete e expiração estão implementadas; ainda é necessário confirmar abrangência jurídica por localidade, qualidade real das evidências e rastreabilidade histórica completa antes do lançamento.
- Verificação jurídica para municípios e modalidades de serviço, seguro e regras de frota, revisão de política de dimensões/peso por veículo.
- Teste **E2E físico**: bicicleta/moto/carro com 4G, GPS negado, GPS perdido, troca de contas, suspensão do app ao abrir Google Maps, coleta por código/geofence, confirmação do comprador e expiração automática da localização.
- Configuração e restrição da chave do mapa incorporado apenas se esta função vier a ser habilitada; não confundir com links externos.
- Validar publicação coordenada de frontend, backend e regras Firebase. **Não liberar PR #1145 ou produção com base apenas nos testes de fonte/CI.**

## Control Plane — incidentes de motofrete após revogação

A partir da PR #1145, a **mesma tela de verificação de identidade** exibe uma fila
privada de `deliveryComplianceIncidents`, para Super Admin, Operations e Compliance.
O controle do incidente é uma operação no servidor existente:
`POST /api/delivery-opportunities/admin/compliance-incidents/:deliveryId/resolve`.
O servidor verifica novamente o vínculo administrativo ativo e não confia em
dados de fase ou identidade enviados pela interface.

**Liberação para novo aceite (somente antes da coleta):**
- Precisa de pedido Kyrub ainda em preparo/pronto na loja, entrega `accepted`,
  `deliveryClaims` em `accepted`, mesmo entregador revogado e hold ativo.
- Nenhum evento de coleta confirmado, `collectedAt`, handoff concluído ou comprovante
  de recebimento pode existir.
- Uma só transação exclui a antiga atribuição, invalida o código anterior,
  retira dados precisos do GPS antigo, reabre a oferta pública e programa nova
  janela de escalonamento. O entregador revogado continua impedido de aceitar
  nova oferta de moto. O pedido **não** é reatribuído a outro usuário arbitrariamente:
  um novo entregador precisa aceitá-lo explicitamente sob as regras vigentes.
- Um evento privado registra operador, motivo, entrega, fase e ID do incidente
  original, sem duplicar dados pessoais do comprador.

**Pacote já em rota:** o operador pode registrar
`request_supervised_handoff`. Isso **não altera a custódia Firestore**,
não coloca um novo entregador como responsável e **não autoriza motofrete
irregular**. O entregador deve parar em local seguro e aguardar a
transferência física supervisionada via suporte. O procedimento físico de
troca de custódia, com dupla confirmação, ainda requer um fluxo próprio
antes de lançamento comercial em escala.

**Encerramento:** o operador pode registrar `close_after_buyer_confirmation`
somente se o documento `deliveryCompletions/{deliveryId}` já estiver
`confirmed` e `settlementEligible=true`, com entrega e claim `done`.
Esse encerramento não cria pagamento, não altera o extrato e não substitui a
confirmação do comprador.

Todas essas ações têm justificativa de 10 a 500 caracteres. A decisão e
um evento em `deliveryComplianceIncidentEvents` são atômicos no servidor.
Repetir exatamente a mesma decisão com o mesmo operador e motivo retorna
o evento anterior, sem novo efeito. As regras Firebase proíbem que usuários,
inclusive administradores via SDK cliente, criem ou alterem esses eventos.

Limitações do piloto: a busca inicial da revogação é limitada às primeiras
100 atribuições (falha reportada ao revisor, hold permanece), a fila visual
exibe no máximo 100 incidentes e a transição de custódia em rota ainda
precisa de homologação física. **Não usar este fluxo como prova de entrega
nem como autorização legal de continuidade do motofrete.**

## Conciliação de remuneração com dois entregadores — sem movimentação de dinheiro

Depois de registrar a transferência física supervisionada, o caso entra em
`transfer_evidence_confirmed_pending_reconciliation`. Esse estágio **não
altera o entregador original no ERP, não publica novas ofertas e não permite
aprovar a entrega em nome do cliente**.

Na mesma função serverless `/api/delivery-opportunities`:
1. Um operador autorizado consulta `/admin/compliance-incidents/:id/remuneration/preflight`
   (GET, somente leitura). O servidor verifica o protocolo de custódia, a fase
   da entrega e o pagamento capturado na coleção econômica da loja canônica.
   A remuneração é derivada **exclusivamente** de
   `economicAllocation.courierRemunerationMinor` validado pela construção
   canônica da obrigação do entregador. Sem captura, com captura duplicada,
   fonte inconsistente, valores zerados ou obrigação `eligible/settled`,
   a proposta falha fechada, sem inventar valor por distância ou pelo campo
   `payment` da oferta.
2. O operador informa as duas parcelas em **centavos inteiros**. O servidor
   exige `originalMinor + substitutoMinor == totalMinor` sem saldo residual
   e cria `deliveryFinancialReconciliations/{deliveryId}`, contendo origem
   econômica, fingerprint, obrigações pendentes e prazo de **24 horas**. Não
   grava novas obrigações de pagamento.
3. Cada entregador vê somente o próprio convite privado e precisa concordar
   com a parcela usando sua própria sessão de autenticação.
4. Depois dos dois aceites, **outro** administrador autorizado (distinto de
   quem preparou a divisão e dos dois participantes) revisa novamente a
   captura e as obrigações atuais. Somente uma fonte econômica inalterada
   permite `approved_pending_manual_execution`. Essa situação significa
   que os termos foram **conferidos**, não que houve transferência, saque
   ou conciliação contábil.
5. Todas as propostas, aceitações e revisões geram eventos append-only em
   `deliveryFinancialReconciliationEvents`, protegidos contra gravações
   dos clientes, inclusive administradores no navegador. O documento
   financeiro contém a fonte e os centavos; a trilha de evidência não contém
   CPF, fotos de documentos ou dados bancários.

As obrigações econômicas anteriores, especialmente remuneração por **tempo
de espera**, permanecem independentes e pendentes de conferência; não se
divide automaticamente qualquer saldo já devido, nem se cria novo crédito
sem a reconciliação contratual. A mera aprovação não executa Pix, não altera
`economicObligations`, `economicSettlements`, `deliveryClaims` ou
`deliveryCompletions`. O procedimento definitivo de transferência da
responsabilidade econômica e do rastreamento depende da definição da
responsabilidade pelas duas etapas, condições de pagamento, autorização
para prosseguimento e aprovação E2E física. Até isso existir, manter o caso
em segurança, com atendimento humano.

## Executor operacional supervisionado — versão isolada (PR #1145)

Após duas confirmações físicas, conferência do supervisor, divisão da remuneração aceita
pelos dois entregadores e revisão econômica independente, um **terceiro Super Admin
independente** pode solicitar `POST /api/delivery-opportunities/admin/compliance-incidents/:deliveryId/execute-reassignment`
com justificativa, pelo Control Plane existente. A verificação é feita novamente
no servidor e **não** depende da visibilidade ou desabilitação do botão na interface.

A transação exige entrega em rota, encomenda coletada, comprador e pedido Kyrub
inalterados, original ainda associado ao claim, bloqueio de motofrete original ativo,
substituto diferente e **habilitado para o veículo e carga**, sem hold, identidade
aprovada, fonte econômica exatamente igual à proposta e ausência de qualquer
obrigação ativa `courier_payable` para a entrega, incluindo espera remunerada.
Obrigações `pending`, `eligible`, `settled` impedem execução; não há reversão
silenciosa. Se qualquer premissa falhar, a transação inteira é cancelada.

Quando aprovada, uma única transação muda `deliveryClaims/{deliveryId}.courierId`,
`hub/renda/deliveries/{deliveryId}.acceptedBy` e o veículo, preserva
`previousCourierId` e as evidências da passagem física, registra eventos
administrativos imutáveis, marca o incidente como
`reassigned_awaiting_buyer_confirmation` e a reconciliação como
`operational_reassigned_awaiting_buyer_confirmation`. O GPS original perde
todas as coordenadas antigas e fica **inativo** até o substituto autenticado
publicar uma nova localização. O status da encomenda permanece `delivering`;
nenhuma conclusão financeira ou transferência bancária ocorre nessa fase.

Apenas depois de o substituto informar chegada com rastreio reativado e o
**comprador confirmar o recebimento**, o serviço canônico de conclusão pode
criar **até duas obrigações separadas** (não são repasses), identificadas pelo
mesmo pagamento capturado e IDs distintos com sufixo `:handoff`. As parcelas
inteiras e não negativas somam exatamente a remuneração da captura, sem
exceder o valor original; parcela zero não produz obrigação. Ambas passam
a `eligible` na mesma transação da confirmação do comprador e são
reconhecidas nos extratos como obrigações, sem enviar Pix automaticamente.
Obrigações já ativas, valor capturado alterado, captura ambígua ou loja
canônica ausente **impedem a confirmação e seus créditos**.

**Limitações de segurança e homologação:** a regra de divisão econômica
precisa de validação contratual e regulatória; os valores de espera são
separados e bloqueiam o executor até serem conciliados; transferências
físicas não são comprovadas apenas por declarações digitais. Ainda faltam
teste de GPS em dispositivo real, verificação presencial e revisão de casos
de disputa/cancelamento e infraestrutura de pagamento antes de operação
comercial. Sem ativação em produção.

## Suporte contextual no mapa do entregador — regras do Kyrub (rascunho para homologação)

Inspirado nos fluxos públicos de suporte do iFood e 99Entrega, mas **sem copiar
as penalidades automáticas, pausas e garantias de atendimento** de terceiros.

O botão **Suporte** aparece no mapa do entregador, no cabeçalho da corrida
mesmo antes de ativar GPS e na versão minimizada do painel de rota. Ao abrir,
o entregador encontra motivos compatíveis com a etapa atual, orientação
situacional e opção de registrar um chamado. A tela também oferece discagem
direta para serviços públicos de emergência do Brasil (190 Polícia, 192 SAMU,
193 Bombeiros). **O Kyrub não aciona emergência por conta própria**, não
promete atendimento 24 horas ou chat em tempo real e orienta a parar em local
seguro antes de usar o celular.

### Categorias oficiais da primeira versão

- **Sempre disponíveis — segurança:** acidente ou lesão; ameaça/roubo/
  assédio/agressão; local de coleta ou entrega perigoso. Prioridade
  `safety`, com instruções de acionar os serviços públicos competentes.
- **Antes da coleta (`accepted`):** loja fechada; pedido não pronto/espera;
  pacote errado, danificado ou incompleto; código de coleta inválido.
- **Rota (`accepted` ou `delivering`):** defeito no veículo;
  via bloqueada; GPS/internet/aplicativo indisponível.
- **Após a coleta (`delivering`):** destinatário ausente ou não atende;
  endereço incorreto; recusa; problema no código de confirmação;
  dano/extravio do pacote.
- **Qualquer etapa:** divergência de valor/distância/espera e outros assuntos.

### Autoridade e custódia

Um chamado é **incidente de suporte**, não cancelamento. `accepted`
permite uma eventual liberação para novo aceite **somente por serviço
operacional autorizado** e se não houver prova de coleta. `delivering`
significa que a encomenda está fisicamente em custódia; nunca se publica
nova oferta ou se marca devolução automática apenas por um motivo de suporte.
O responsável pela logística deve optar por retorno comprovado à loja,
correção supervisionada ou transferência física segura com o protocolo
de duas confirmações já desenvolvido. Para destinatário não localizado,
a referência externa da 99 orienta tentativas de contato e espera de ao
menos 10 minutos, mas **esse prazo ainda não é uma regra automática do
Kyrub**: depende de temporizador auditável e de política aprovada de
devolução, remuneração e condições de segurança. Não há punição automática
por reportar acidentes, riscos, problemas técnicos ou espera.

### Infraestrutura de chamados

`POST /api/delivery-opportunities/:deliveryId/support-tickets` exige
Firebase ID Token do próprio entregador vinculado ao `deliveryClaims` e à
entrega canônica, etapa válida e categoria autorizada. A chave de idempotência
de cada criação é gerada pelo cliente; tentativas repetidas com a mesma
chave não duplicam tickets. Chamados normais têm intervalo mínimo de 20 s
por entregador para conter abuso; relatórios com prioridade de segurança
não esperam pelo intervalo. Os dados contêm estado, tipo e narrativa
opcional, **sem capturar latitude, longitude, telefone, CPF ou endereço**.
Ticket e evento de abertura são criados na mesma transação Firebase;
a entrega, seu claim, pagamento e rastreio **não são modificados**.

`deliverySupportTickets/{ticketId}` é legível apenas por quem abriu
o chamado e por Operations/Compliance/Super Admin ativos no Control
Plane. Alterações e exclusões no navegador são proibidas. Os eventos
`deliverySupportTicketEvents` são escritos exclusivamente no backend,
com acesso de leitura administrativo. A fila no Control Plane mostra
segurança primeiro e permite que operador autorizado assuma, responda
e encerre o chamado, registrando cada etapa. O entregador vê o estado
e a última resposta na própria tela de suporte. A tela informa que a
fila **não implica resposta imediata**. Por enquanto não há chat online,
telefone comercial do Kyrub nem plantão confirmado.

Pendências de lançamento: procedimento operacional com responsáveis humanos,
escalonamento e SLA real; proteção e retenção de relatos sensíveis;
retorno/devolução com comprovação, tempo de espera e remuneração;
ações seguras do suporte ligadas ao contrato de custódia; validação de
usabilidade e acessibilidade em aparelho físico; teste de mapa móvel
com concorrência de telas e conectividade precária. Não habilitar
em produção sem homologação.
