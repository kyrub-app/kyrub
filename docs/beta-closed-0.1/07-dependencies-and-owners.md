# Dependências e responsáveis

## Como usar

Preencher nomes, datas e decisões antes da abertura do beta. Uma dependência sem responsável não deve ser tratada como concluída.

| Área | Entregável | Responsável | Situação | Bloqueia o beta? |
| --- | --- | --- | --- | --- |
| Produto | aprovar escopo da rodada | proprietário do Kyrub | pendente | sim |
| Produto | selecionar 5 a 15 participantes | proprietário do Kyrub | pendente | sim |
| Produto | revisar PRs visuais em dispositivos reais | proprietário + desenvolvimento | aguardando preview | sim |
| Suporte | definir canal e horário de atendimento | proprietário do Kyrub | pendente | sim |
| Suporte | preparar respostas-padrão | operação | pendente | não |
| Jurídico | revisar Termos e Política de Privacidade | jurídico | pendente | sim para beta externo |
| Privacidade | definir controlador e contato do titular | proprietário + jurídico | pendente | sim |
| Privacidade | definir retenção e exclusão | jurídico + desenvolvimento | pendente | sim para ampliação |
| Contabilidade | definir entidade empresarial futura | proprietário + contador | pendente | não para teste interno |
| Infraestrutura | liberar e validar preview | Vercel + desenvolvimento | bloqueado por cota | sim para revisão visual |
| Infraestrutura | revisar variáveis de produção | desenvolvimento | pendente | sim |
| Firebase | publicar regras e índices aprovados | desenvolvimento autorizado | pendente | conforme PRs incluídos |
| Segurança | validar conta administrativa controlada | proprietário + desenvolvimento | pendente | sim |
| Segurança | preparar rollback e incidente | desenvolvimento + operação | em documentação | sim |
| Observabilidade | definir monitoramento de erros e custos | desenvolvimento | pendente | recomendado |
| Beta | aplicar roteiro e registrar problemas | responsável pelo beta | pendente | execução |

## Separação por quem decide

### Proprietário do Kyrub

- participantes;
- escopo e duração;
- canal de suporte;
- domínio e identidade pública;
- decisão de iniciar, pausar ou ampliar;
- priorização de experiência e negócio.

### Desenvolvimento

- branches e PRs;
- testes e build;
- regras e índices;
- variáveis e segredos;
- saúde, logs e rollback;
- correção e regressão.

### Jurídico e privacidade

- Termos de Uso;
- Política de Privacidade;
- bases legais e finalidades;
- idade mínima;
- retenção, exclusão e canal do titular;
- regras de conteúdo, denúncia e moderação.

### Contador

- situação e estrutura do CNPJ;
- regularização fiscal;
- atividades econômicas e enquadramento;
- preparação empresarial para contratos futuros.

### Fornecedores

- Vercel: deploy e disponibilidade;
- Firebase/Google: autenticação, banco e regras;
- Gemini: capacidade da Kyrubia;
- futuros parceiros: somente após contrato e homologação.

## Fora desta rodada

Não bloqueiam o Beta Fechado 0.1 quando estiverem desativados e claramente identificados:

- PagBank e Carteira Kyrub;
- cobrança de planos;
- cartão, Pix, split ou custódia;
- KYC e biometria reais;
- emissão fiscal real;
- publicação em lojas de aplicativos;
- integrações comerciais ainda não homologadas.
