# Kyrub Device Fabric — NFC, BLE e LoRa (fase 1, 21/11/2026)

## Objetivo
A Central Pessoal mantém **Movimentações / Controle financeiro** na primeira linha e agora **Conquistas / Dispositivos** na segunda. **Desafios da plataforma** continua em largura inteira. O ícone de Conquistas representa um cocar; o painel de XP/Pitangas permanece o mesmo.

**Dispositivos** começa pelo **Meu smartphone (fase zero)**, uma preparação local opcional, única por conta e perfil do navegador, e abre a preparação local de dois acessórios:
- **Kyrub Tag**, tag passiva NFC NDEF para identificação por proximidade;
- **Kyrub Link**, chaveiro eletrônico ativo previsto para BLE + rádio LoRa.

O sistema foi desenhado offline-first: o aparelho guarda um rascunho **não autoritativo** por UID em armazenamento local; ao mudar de usuário, os rascunhos de outra conta não aparecem. Nenhum token de tag, segredo, serial, latitude, identificação pessoal ou mensagem de rádio é salvo neste rascunho. São no máximo 12 nomes/tipos por usuário/aparelho. Não existe sincronização deste rascunho entre celulares.

## Fase zero — smartphone
O próprio celular inicia a família Kairub: tag crua, chaveiro plastificado, medalhão de couro, medalhão eletrônico, case robusta e dispositivo de pulso são evoluções posteriores. A preparação do smartphone não consome a cota dos acessórios. É idempotente; o identificador aleatório pertence ao registro local do navegador, não ao hardware. O teste NFC usa uma leitura NDEF real por gesto explícito e guarda somente a data do último evento confirmado. A presença de NDEFReader não confirma hardware ou permissão. Não habilita o rádio pelo aplicativo, não grava a tag, não autentica a conta e não transforma o telefone em tag. Para identidade NFC digital é necessário Android nativo com HCE (ISO-DEP/APDU) e leitor compatível, autorização e protocolo de segurança; não faz parte da Web NFC. Referências: https://developer.chrome.com/docs/capabilities/nfc e https://developer.android.com/develop/connectivity/nfc/hce.

## O que funciona nesta fase
1. Navegação Central Pessoal > Dispositivos.
2. Adicionar, listar e remover nomes/tipos de dispositivos neste aparelho, inclusive offline após o app já estar disponível localmente.
3. **Web NFC leitura real**, somente em contexto HTTPS com Chrome para Android compatível e NFC ativo. O usuário toca em **Ler NFC** para autorizar a leitura de NDEF; o app recebe apenas o sinal de leitura, conta de registros e carimbo de hora. Não guarda NDEF bruto nem UID NFC.
4. Estado explícito de indisponibilidade de NFC e aviso quando não há NDEF legível.
5. Indicadores honestos: Web Bluetooth BLE disponível/não disponível no navegador; **nenhum** rádio LoRa é pareado ou transmitido.

Nenhum registro local pode ser exibido como registrado, vinculado, homologado ou autenticado. Nenhuma leitura NFC por si só prova propriedade ou autoriza o uso do dispositivo.

## O que NÃO está implementado
- Provisão e gravação segura de NTAG213/215, autenticação da tag e titularidade no servidor;
- vínculo autorizado de dispositivo a uma conta Kyrub, revogação e transferência;
- firmware do chaveiro Kyrub Link, perfil GATT BLE, comandos no rádio ou gateway;
- transmissão LoRa pelo telefone (não existe hardware LoRa acessível por API Web);
- upload de eventos offline, sincronização entre aparelhos, localização em tempo real e SOS;
- autorização de pedidos, pagamentos, XP, Pitangas ou acesso a contas via NFC/BLE/LoRa.

Esses comportamentos exigem especificações de hardware, backend e segurança próprias, e não devem ser simulados com mensagens de sucesso.

## Arquitetura para a comunicação futura
```
Kyrub Tag NFC ──aproximação──> Android/Chrome (Web NFC)
                                  │
Kyrub Link ────── BLE/GATT ────────┤  Kyrub Device Runtime
       │                          │  (autorização local limitada;
       └── rádio LoRa ── nó ──────┤   fila offline, TTL e deduplicação)
                         │        │
                     Gateway ─────┘──── Internet quando disponível
                                  │
                       Backend Kyrub / Firestore
                       (identidade, validação de assinatura,
                        autorização, política e reconciliação)
```

**Transporte não é autoridade.** Chaves/credenciais devem nascer num provisionamento confiável; tokens NFC devem ser opacos e revogáveis; nunca inserir dados pessoais, tokens de login, pedidos ou valores em um frame RF. O contrato `shared/kyrubDeviceLinkContract.ts` tipa eventos curtos e rejeita payloads fora do limite; sua validação é apenas sintática. Antes de consumir qualquer evento real, o bridge precisa comprovar assinatura/autenticidade, freshness/TTL, sequência, controle de replay, propriedade/revogação e consentimento.

### Entregas técnicas seguintes, quando houver hardware definido
1. **NFC real de ponta a ponta:** esquema NDEF provisionado pelo Kyrub, leitura com challenge do servidor, reivindicação/transação verificada (nunca somente número serial), troca ou revogação da associação; modo offline restrito a identificação não autoritativa.
2. **BLE chaveiro:** firmware com características/serviços GATT publicados; handshake autenticado e chaves efêmeras; aplicação acessa essas características por Web Bluetooth quando compatível. Sem UUIDs inventados ou conexão indiscriminada a periféricos.
3. **LoRa transporte:** selecionar modo rádio ponto a ponto versus LoRaWAN com gateway, banda e canal após análise regulatória e equipamento homologado; definir criptografia ponta a ponta, números de sequência, buffers, fragmentação, retransmissão, TTL, economia de bateria e aceitação de mensagens em uma ponte física. Sem mandar payloads longos.
4. **Event fabric offline:** Dexie/IndexedDB para eventos assinados e fila com limites, confirmação de entrega, idempotência, detecção de replay, expiração, sincronização do gateway e reconciliação posterior na autoridade Firestore. Reservar SOS para um fluxo especializado com confiabilidade e auditoria; não apresentá-lo como funcional enquanto não existir.

### Requisitos regulatórios
Equipamentos emissores de radiofrequência destinados a uso/comercialização no Brasil dependem da homologação e dos requisitos vigentes da Anatel. Não há frequência, potência ou modulação fixada neste código: primeiro validar o modelo do rádio, a finalidade, a banda permitida, o gateway, as condições de radiação restrita e a homologação do produto. A região exata de LoRaWAN e a escolha de canais NÃO podem ser inferidas apenas pela localização do usuário.

Referências:
- https://www.semtech.com/technology/what-is-lora
- https://developer.chrome.com/docs/capabilities/nfc
- https://support.google.com/chrome/answer/6362090?co=GENIE.Platform%3DAndroid
- https://www.gov.br/pt-br/servicos/homologar-produtos-de-telecomunicacoes-anatel

## Aceite
- Android estreito: dois cards com títulos legíveis, sem transbordamento; Desafios mantém largura dupla.
- Clicar em Conquistas preserva Pitangas/XP, sem duplicar conta.
- Preparações locais podem ser criadas/recuperadas/removidas offline e isoladas por UID.
- NFC requer clique/permissão do usuário; cancelar, remover ou fechar painel aborta leitura; sem gravação e sem persistência de tokens.
- LoRa sem hardware retorna estado **pendente**, não "conectado".
- Sem alterações em Firebase Rules, contratos de pagamento, ledger, escritores XP/Pitangas, gamificação ou roteamento de produção.
