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
