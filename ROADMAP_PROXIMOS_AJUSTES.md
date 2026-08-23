# Kyrub — Roadmap Canônico de Próximos Ajustes

Atualizado em: 2026-08-23

Este arquivo é a continuação versionada do roadmap canônico que vinha sendo mantido fora do repositório. A partir desta versão, ele deve acompanhar o código e ser atualizado quando um bloco for concluído, adiado, dividido ou quando uma nova dependência relevante for descoberta.

## Regra de governança

- Não escolher o próximo bloco com base apenas em memória da conversa.
- Reconciliar este arquivo com o estado real do `main` antes de iniciar uma nova frente.
- Toda mudança operacional relevante deve sair com teste/contrato e, quando aplicável, com deploy confirmado.
- Owner Gates ficam explícitos e não devem ser contornados por automação.
- Não criar dados falsos em produção para liberar testes de estoque, entrega ou pagamento.

## Legenda

- ✅ concluído e integrado
- 🟡 em andamento / parcialmente concluído
- ⏸️ aguardando Owner Gate
- ⬜ pendente

## Estado consolidado

### 1. Base Kyrubia e Camada de Ações

- ✅ `create_note` com proposta, confirmação e recibo autoritativo.
- ✅ criação determinística de tarefas/notas sem escrita direta da LLM.
- ✅ leitura real do ERP e ferramentas compartilhadas de consulta.
- ✅ contexto de turno e continuidade sem transformar histórico em autoridade operacional.
- ✅ envelopes de erro/conflito e ações sensíveis sujeitas a confirmação.
- ✅ execução segura, idempotência e recibos para ações implementadas.

### 2. Catálogo, produtos e loja

- ✅ fundação de análise/importação de catálogo pela Kyrubia.
- ✅ cadastro/atualização determinística de produtos e perfil da loja.
- ✅ composição/ficha técnica como base para estoque vendável.
- ✅ reconciliação de estoque vendável após ajustes autoritativos.
- 🟡 disponibilidade legítima do catálogo ainda depende da composição/estoque real dos produtos do teste final.
- ⬜ ampliar proveniência de correções e histórico de alterações em catálogo quando necessário.

### 3. Estoque, compras e transformação

- ✅ ajuste determinístico de estoque.
- ✅ leitura multimodal de nota fiscal com proposta de entrada, sem mutação automática.
- ✅ fluxo guiado de recebimento: ler compra → informar que estoque não foi alterado → perguntar destino dos itens.
- ✅ transformação universal de matéria-prima em intermediários, acabados e subprodutos, com perdas registradas.
- ✅ confirmação explícita e idempotência de transformações.
- ✅ reconciliação de produtos vendáveis após movimentação de estoque.
- ⬜ evoluir recebimento guiado de texto para cards/decisões estruturadas por item e divisões de destino.

### 4. Pagamentos / Mercado Pago / Pix

- ✅ Vault de credenciais de produção com criptografia AES-256-GCM.
- ✅ readiness/teste server-side da integração Mercado Pago.
- ✅ webhook autoritativo de pagamento e intents de pagamento.
- ✅ UI de Pix pendente sem marcar pagamento como concluído no frontend.
- ✅ reutilização do mesmo Pix pendente na sessão, evitando duplicidade acidental.
- ⏸️ primeiro Pix real controlado: somente depois de haver produto legítimo e vendável no catálogo e com confirmação imediata do proprietário antes do pagamento.

### 5. Kyrubia — BYO-AI e Créditos Kyrubia

- ✅ política: LLM usa prioritariamente provedor conectado pelo usuário.
- ✅ ações determinísticas não consomem Créditos Kyrubia apenas por terem sido iniciadas pela Kyrubia.
- ✅ `Créditos Kyrubia` separados de `K-Coins`; termo ambíguo "moedas Kyrubia" descontinuado.
- ✅ Vault de credenciais por UID/provider, criptografado e server-only.
- ✅ Gemini, OpenAI e Anthropic com adapters normalizados.
- ✅ preferência explícita de provedor; sem ordem oculta quando há vários disponíveis.
- ✅ cutover de conversas textuais para a IA própria do usuário.
- ✅ falha do provedor próprio não autoriza fallback pago silencioso.
- ✅ UX para usuário leigo: Créditos Kyrubia como caminho simples e API própria como opção avançada.
- ⏸️ primeiro teste real de chave/API pelo proprietário, diretamente na tela `Minha IA`.
- ⬜ normalização multimodal para anexos usando o provedor próprio do usuário.
- ⬜ ledger comercial autoritativo de Créditos Kyrubia.
- ⬜ saldo, compra/recarga e extrato de Créditos Kyrubia.
- ⬜ cotação de custo por classe de operação, sem expor tokens como unidade comercial.
- ⬜ consentimento/preferência para fallback pago por Créditos Kyrubia.

### 6. Memória e histórico da Kyrubia

- ✅ cache local por UID, com limites e sanitização de mensagens/anexos.
- ✅ memória entre conversas com distinção entre contexto histórico e verdade operacional atual.
- 🟡 sincronização do histórico entre dispositivos por usuário — implementação em andamento na próxima PR.
- ⬜ revisar resumos progressivos/rolling summaries para conversas longas e custo de contexto.

### 7. Entregas Kyrub e fallback externo

- ✅ fila automática de oportunidades Kyrub já existe.
- ✅ claim de entrega interno é atômico/idempotente.
- ✅ existe estado de escalonamento após janela sem aceite.
- ⬜ corrigir relógio de 3 minutos para começar somente quando o pedido estiver `ready`, nunca em `preparing`.
- ⬜ criar provider router externo genérico; Lalamove como primeiro provider.
- ⬜ remover imediatamente pedido da fila interna quando provider externo assumir a entrega.
- ⬜ impedir dupla autoridade/despacho duplo e manter idempotência de criação de corrida.
- ⬜ tracking/webhooks do provider externo e reconciliação de estados.
- ⬜ teto de custo e regras operacionais de fallback no beta.
- ⬜ preparar extensibilidade para Loggi/outros providers sem acoplar o núcleo à Lalamove.

### 8. Performance, observabilidade e governança

- ✅ medição técnica de uso de IA separada do futuro ledger comercial de créditos.
- ✅ health/readiness administrativo para integrações já implementadas.
- ✅ contratos de segurança e suites de regressão para áreas críticas.
- ⬜ rolling summaries e redução de contexto repetido em conversas longas.
- ⬜ ampliar observabilidade de roteamento BYO-AI/funding source na interface administrativa conforme o ledger evoluir.
- ⬜ revisar periodicamente limites de bundle, funções Vercel e custos operacionais.

## Owner Gates abertos

1. ⏸️ **Teste de chave BYO-AI** — proprietário fará quando estiver disponível, colando a chave somente dentro do Kyrub.
2. ⏸️ **Primeiro Pix real** — somente após disponibilidade legítima de produto e confirmação explícita imediatamente antes do pagamento.

## Próxima sequência operacional

1. 🟡 **Histórico da Kyrubia sincronizado por UID entre dispositivos**.
2. ⬜ **Normalização multimodal BYO-AI** para imagem/PDF usar a IA própria quando suportado.
3. ⬜ **Créditos Kyrubia: ledger, saldo, cotação e consentimento de fallback**.
4. ⬜ **Disponibilidade legítima de produto + Owner Gate do primeiro Pix real**.
5. ⬜ **Entregas: timer somente em `ready` + provider router externo/Lalamove**.
6. ⬜ **Performance de contexto, resumos progressivos e observabilidade adicional**.

## Observação sobre a lista histórica

A versão textual exata que circulou anteriormente como "36 pontos" e depois foi ampliada não foi recuperada integralmente como uma lista numerada única. O documento canônico de 2026-08-13 foi recuperado e esta versão reconcilia aquele roadmap com o estado efetivamente integrado no `main` até 2026-08-23. Não devem ser recriados itens históricos não comprovados apenas para reproduzir uma contagem antiga.
