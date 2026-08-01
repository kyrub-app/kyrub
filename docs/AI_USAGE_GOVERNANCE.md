# Governança de uso e custos da Kyrubia

## Princípio comercial

Kyrub não vende uma chave, uma conta ou uma quantidade bruta de tokens de terceiros. O usuário contrata capacidades e resultados dentro do Kyrub.

A infraestrutura pode utilizar Gemini, OpenAI ou outros fornecedores no futuro, desde que o Kyrub preserve segurança, contexto, confirmação e qualidade.

## O que medir antes de definir planos

Por solicitação:

- usuário e plano por identificador interno;
- modelo e fornecedor;
- horário e duração;
- tokens de entrada e saída quando fornecidos;
- custo estimado;
- resultado: sucesso, erro, cota, timeout ou cancelamento;
- ação proposta;
- ação confirmada ou rejeitada;
- tamanho do contexto;
- origem: texto, voz ou automação.

Não registrar em telemetria o conteúdo integral da conversa por padrão. Conteúdo necessário para suporte exige finalidade, acesso restrito e retenção definida.

## Limites diferentes

### Limite técnico

Protege o sistema contra payloads enormes, loops e rajadas. Deve ser invisível para uso normal e aplicado independentemente do plano.

Exemplos:

- tamanho máximo de mensagem;
- histórico máximo enviado ao modelo;
- requisições por minuto;
- timeout;
- limite de tentativas automáticas.

### Limite do fornecedor

Cota, rate limit ou indisponibilidade do Gemini/OpenAI. A mensagem deve dizer que o serviço de IA está temporariamente limitado, sem culpar o plano do usuário.

### Franquia comercial

Quantidade de capacidade incluída em um plano. Só deve ser ativada depois de haver medição real de custo e comportamento.

## Unidade comercial recomendada

Não tratar toda interação como equivalente. Uma pergunta curta, geração de imagem, leitura de documento e ação em lote têm custos e valores diferentes.

Usar créditos internos ou categorias de capacidade:

- conversa simples;
- elaboração extensa;
- ação confirmada;
- processamento de documento;
- geração de mídia;
- automação ou lote.

O usuário deve entender o impacto antes de confirmar uma operação excepcionalmente cara.

## Plano gratuito

Objetivos:

- permitir conhecer a Kyrubia;
- demonstrar valor real;
- impedir abuso automatizado;
- não criar custo ilimitado.

A franquia definitiva não deve ser escolhida por intuição. Primeiro medir o beta e calcular custo por usuário ativo, margem e distribuição de uso.

## Planos pagos

Possíveis diferenciais:

- franquia maior;
- histórico/contexto ampliado;
- ações adicionais;
- processamento em lote;
- voz e mídia;
- equipes e permissões;
- relatórios e automações;
- prioridade de execução.

A assinatura deve vender produtividade e capacidade, não “quota do Gemini”.

## Ações da Kyrubia

Fluxo padrão:

1. interpretar;
2. preparar proposta;
3. mostrar resultado e impacto;
4. solicitar confirmação;
5. executar pelo domínio do Kyrub;
6. registrar sucesso ou falha.

Ações destrutivas, financeiras, públicas ou que alterem permissões exigem controles adicionais e não devem ser liberadas apenas por prompt.

## Multi-modelo

Adicionar outro fornecedor somente quando houver necessidade mensurável:

- melhor qualidade para uma tarefa;
- menor custo total;
- redundância;
- requisito empresarial;
- capacidade inexistente no modelo atual.

O roteador futuro deve considerar qualidade, custo, latência, privacidade e disponibilidade. A troca não pode alterar silenciosamente garantias de dados.

## Alertas operacionais

Configurar alertas para:

- aumento abrupto de solicitações;
- custo diário acima do orçamento;
- taxa de erro por modelo;
- repetição de tool call;
- loops de confirmação;
- latência excessiva;
- usuários ou IPs automatizados;
- cota próxima do limite.

## Decisões que exigem validação do proprietário

- preço e franquia de cada plano;
- margem mínima;
- recargas e validade de créditos;
- quais ações são premium;
- política de uso justo;
- retenção de conversas;
- fornecedor alternativo;
- orçamento e alertas de produção.
