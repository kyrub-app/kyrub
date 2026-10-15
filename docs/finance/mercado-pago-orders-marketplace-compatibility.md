# Mercado Pago — decisão revisada: Marketplace como operação, OAuth e split futuro

**Decisão em 15/10/2026.** Modelo B confirmado; PR #949 permanece Draft, sem merge. Nenhuma aplicação, credencial, cobrança, comissão ou split foi criada/habilitada nesta revisão.

## Correção da interpretação anterior

A aplicação Kyrub **já existente** foi criada para Checkout Transparente + Payments API e dispõe, em **Configurações avançadas**, de Redirect URLs, PKCE e permissões `read`, `offline_access` e `write`. O formulário **novo** de criação de aplicação mostra Checkout Transparente e escolha Payments/Orders, mas **não mostra uma opção visível "Marketplace"**.

O retorno de orientação técnica encaminhado pelo proprietário explica que, no painel novo, marketplace é **modelo operacional**: app + **OAuth individual do vendedor** + checkout com credenciais do vendedor. A documentação pública atual de OAuth e de checkout em marketplace confirma esse fluxo operacional. Porém, a **página mais antiga de configuração de Split 1:1 ainda diz "Escolha o modelo de integração Marketplace"**; portanto, registrar essa divergência documental sem afirmar que exista botão oculto ou autorização comercial automática.

**Recomendação atual: NÃO criar outra aplicação só por ausência da opção Marketplace.** Primeiro testar elegibilidade e capacidade OAuth da aplicação Kyrub existente. Aplicação separada é opcional por isolamento operacional, e somente mediante decisão explícita posterior; não uma condição demonstrada.

## Passo administrativo na aplicação já existente

1. Em Mercado Pago Developers → aplicação **Kyrub** → Configurações da aplicação → Configuração avançada, informar **exatamente** o redirect estático de produção `https://kyrub.com/api/store-connections/mercado-pago/callback`, sem parâmetros nem hostname temporário.
2. Habilitar **PKCE = Sim**, porque o código vigente do Kyrub usa `code_challenge`, `code_challenge_method=S256` e `code_verifier`. Confirmar previamente que não existe outro cliente OAuth legado da **mesma aplicação** que deixe de funcionar após exigir PKCE.
3. Preservar os escopos necessários `read`, `offline access` e `write`. Não alterar o produto Checkout Transparente nem a API Payments dessa aplicação; **não clicar em Excluir**.
4. Depois de salvar configurações de aplicação com confirmação do proprietário, conferir **Client ID (número da aplicação)** e **Client Secret** em origem oficial, e cadastrá-los **somente** em `admin.kyrub.com → Integrações & Infraestrutura → Mercado Pago · OAuth de lojistas`, com Redirect URI igual. Jamais revelar Client Secret ou tokens no chat. Não regravar Access Token do checkout central.
5. Confirmar retorno de status administrativo **Configurada** com sufixos mascarados e acesso ao Vault v1 em produção. A Shared `INTEGRATION_MASTER_KEY` encontrada vale **Production**, não Preview; não replicá-la indiscriminadamente a deploys efêmeros.
6. Somente depois, autorizar conta do próprio lojista via OAuth. **Não criar Pix real automaticamente**: usar pré-verificação de autoridade/collector proposta na PR #949 e teste humano de pedido, Pix, webhook e conciliação antes de promover checkout novo.

## Decisão de API e split

- **Payments API** continua operacional e recebendo correções de segurança e estabilidade, embora a documentação recomende Orders para integrações inteiramente novas. Não há data pública de desligamento confirmada pelo material examinado.
- O checkout canônico Kyrub atual usa `/v1/payments`; a PR #949 busca emitir **novos Pix** sob OAuth da loja, mantendo Pix históricos vinculados à credencial de origem, sem split e sem segunda cobrança.
- Para **split 1:1** futuro, a Payments API documenta `application_fee` com OAuth do vendedor no Checkout Transparente; exemplo público usa **cartão**. **Compatibilidade da comissão com Pix não está comprovada** pelos exemplos gerais; não cobrar nem afirmar suporte antes de teste seguro autorizado e elegibilidade real.
- **Orders API** possui Pix, mas endpoints, modelos, notificações, estorno e conciliação diferentes. Não possui equivalente explícito documentado de `application_fee` para o modelo 1:1 no material verificado; futura migração requer PR própria e preservação dos contratos legados.
- **Split 1:N** via Orders exige vínculo comercial, consentimento e configuração de múltiplos recebedores; não pressupor acesso automático.

## Gates e princípios de segurança

- A aplicação **Mercado Livre OAuth** é distinta e nunca fornece credenciais do Mercado Pago.
- Checkout da loja pertence ao lojista; assinatura/plano do Kyrub pertence à plataforma; venda externa MP é **espelhada**, sem pagamento recriado.
- Nenhuma nova comissão, `application_fee`, `marketplace_fee` ou `splits` entra na PR #949.
- Nunca recadastrar credenciais por tentativa e erro ou gerar master key substituta.
- PR #949 fica **Draft sem merge** até validação em ambiente autorizado: OAuth conectado, identidade `collector_id` correta, emissão de Pix controlada, webhook assinado, conciliação idempotente, preservação dos Pix históricos.

## Documentação oficial consultada
- Marketplace via Checkout Transparente: https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/how-tos/integrate-marketplace
- Visão geral e manutenção Payments API: https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/overview
- OAuth e PKCE: https://www.mercadopago.com.br/developers/pt/docs/security/oauth/creation
- Configurações avançadas existentes: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/application-details
- Guia legado de criação para split 1:1 (divergência "modelo Marketplace"): https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/create-configuration
- Comissão 1:1: https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace
- Split 1:N: https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/resources/split-payments-1-n
