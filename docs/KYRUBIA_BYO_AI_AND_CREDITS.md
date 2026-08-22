# Kyrubia — BYO-AI e Créditos Kyrubia

## Decisão de produto

A Kyrubia separa inteligência generativa de execução determinística.

- **Interpretação/geração que exige LLM** deve usar prioritariamente um provedor de IA conectado pelo próprio usuário.
- **Créditos Kyrubia** são a alternativa paga para usar a infraestrutura generativa fornecida pelo Kyrub quando o usuário não possui um provedor próprio disponível ou escolhe essa modalidade.
- **Execução determinística do Kyrub** não consome Créditos Kyrubia apenas por ter sido iniciada pela Kyrubia.

## Nomenclatura oficial

### Créditos Kyrubia

Unidade comercial comprada com dinheiro real e consumida exclusivamente por capacidades generativas fornecidas pela infraestrutura do Kyrub.

Créditos Kyrubia não representam tokens de um fornecedor específico e não devem expor ao usuário a contabilidade bruta de tokens como unidade comercial.

### K-Coins

Sistema separado de gamificação/recompensas. K-Coins não são Créditos Kyrubia, não são saldo financeiro e não devem ser tratados como forma de pagamento da camada generativa, salvo decisão futura explícita de produto.

O termo **"moedas Kyrubia"** fica descontinuado por ser ambíguo.

## Ordem de roteamento

Para uma solicitação que exige LLM:

1. usar o provedor próprio do usuário quando estiver conectado e disponível;
2. se não houver provedor próprio, usar Créditos Kyrubia somente quando essa modalidade estiver habilitada e houver saldo suficiente;
3. se um provedor próprio conectado falhar, nunca migrar silenciosamente para uma rota paga;
4. o fallback para Créditos Kyrubia após falha do provedor próprio exige consentimento explícito para a tentativa ou preferência previamente ativada pelo usuário;
5. sem provedor utilizável nem Créditos Kyrubia disponíveis, bloquear apenas a capacidade generativa e preservar as capacidades determinísticas compatíveis.

## Fronteira de autoridade

O provedor de IA nunca é autoridade operacional sobre dados do Kyrub.

A LLM pode interpretar, resumir e preparar propostas. A execução continua sujeita aos contratos determinísticos do Kyrub: autenticação, revalidação server-side, confirmação quando aplicável, transação, idempotência e recibo.

Trocar Gemini por OpenAI, Anthropic ou outro provedor não altera essas garantias.

## Credenciais de provedores do usuário

Credenciais devem:

- ser recebidas somente em fluxo autenticado;
- permanecer apenas em memória durante a requisição de gravação/teste;
- ser criptografadas server-side antes da persistência;
- nunca ser devolvidas integralmente ao navegador depois da gravação;
- ser vinculadas ao UID e ao provider no associated data do envelope criptográfico;
- permitir somente metadados mascarados/status no cliente;
- ter teste de conexão server-side antes de serem consideradas disponíveis para roteamento.

## Metering e cobrança

`kyrub_usage_events` mede uso técnico e custo do fornecedor. Esse ledger não é o saldo de Créditos Kyrubia.

Cada evento generativo deve registrar, quando conhecido:

- provider;
- modelo;
- funding source (`user_provider`, `kyrubia_credits` ou compatibilidade legada durante migração);
- operação;
- tokens/metadados disponibilizados pelo fornecedor;
- custo estimado do fornecedor quando precificável.

O débito de Créditos Kyrubia deve pertencer a um ledger comercial separado, autoritativo e idempotente. Medir tokens/custo nunca deve, por si só, criar débito comercial.

## Matriz mínima de comportamento

| Cenário | Rota generativa | Créditos Kyrubia |
| --- | --- | --- |
| Operação determinística | motor Kyrub | 0 |
| Gemini/OpenAI/Anthropic próprio disponível | provedor do usuário | 0 |
| Nenhum provedor + Créditos Kyrubia habilitados e com saldo | infraestrutura Kyrub | debita conforme regra comercial |
| Nenhum provedor + sem créditos | bloqueia apenas LLM | 0 |
| Provedor próprio falha + sem consentimento de fallback | pede consentimento | 0 |
| Provedor próprio falha + fallback pago aprovado | infraestrutura Kyrub | debita conforme regra comercial |

## Fases de implementação

1. contrato de roteamento e atribuição de funding source;
2. armazenamento/teste seguro de credenciais por usuário/provider;
3. resolver de provedor ativo por UID;
4. adaptação dos clientes Gemini/OpenAI/Anthropic;
5. ledger e saldo de Créditos Kyrubia;
6. cotação/aviso de custo por classe de operação;
7. fallback consentido e preferências do usuário;
8. UI de Integrações de IA e observabilidade administrativa.
