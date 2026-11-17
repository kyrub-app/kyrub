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

### Bloqueio intencional de motofrete

`courierVehicleDocumentEligibility` exige uma avaliação complementar de motofrete aprovada, atestada por humano e não expirada. O registro atual `identity_verifications` ainda **não permite gravar essa atestação pelo cliente ou pelo painel administrativo**. Portanto, o aceite de **moto fica bloqueado** neste estágio, até a implementação e os testes de um fluxo autorizado e auditado para essa verificação na mesma central de identidade. Este bloqueio não deve ser removido só para fazer o E2E passar.

Isso **não** altera a aprovação original da pessoa para outras atividades. Carro continua sujeito à validação da categoria B/EAR no fluxo atual e às exigências locais/regras de frota ainda não atestadas; não existe certificação legal automática de carro.

## Pendências para liberação comercial

- Fluxo de atestação administrativa com comprovação documental de motofrete e expiração/rechecagem, sem sistema de identidade paralelo.
- Verificação jurídica para municípios e modalidades de serviço, seguro e regras de frota, revisão de política de dimensões/peso por veículo.
- Teste **E2E físico**: bicicleta/moto/carro com 4G, GPS negado, GPS perdido, troca de contas, suspensão do app ao abrir Google Maps, coleta por código/geofence, confirmação do comprador e expiração automática da localização.
- Configuração e restrição da chave do mapa incorporado apenas se esta função vier a ser habilitada; não confundir com links externos.
- Validar publicação coordenada de frontend, backend e regras Firebase. **Não liberar PR #1145 ou produção com base apenas nos testes de fonte/CI.**
