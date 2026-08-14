# Governança de uso e custos da Kyrubia

## Princípio comercial

Kyrub não vende uma chave, uma conta ou uma quantidade bruta de tokens de terceiros. O usuário contrata capacidades e resultados dentro do Kyrub.

A infraestrutura pode utilizar Gemini, OpenAI ou outros fornecedores no futuro, desde que o Kyrub preserve segurança, contexto, confirmação e qualidade.

## #169 — Usage/Metering Engine

A primeira implementação de metering deve ser independente de fornecedor e registrar somente metadados técnicos/contábeis necessários para entender custo e capacidade.

O ledger V1 usa eventos imutáveis em `kyrub_usage_events`. Cada chamada generativa bem-sucedida pode gerar um evento próprio, inclusive quando um único pedido da Kyrubia exige uma segunda chamada após uma leitura do ERP.

O identificador do evento deve ser determinístico por request + índice da chamada. Repetir a mesma gravação não pode duplicar consumo.

O navegador não pode criar, editar nem apagar eventos de metering. A gravação pertence ao backend/Admin SDK. A leitura administrativa de custos fica restrita a papéis explicitamente autorizados no Control Plane.

### Separação obrigatória

Estes conceitos são diferentes e nunca devem ser fundidos no mesmo saldo:

1. **Custo do fornecedor** — o que Gemini/OpenAI/outro fornecedor custa ao Kyrub.
2. **Créditos Kyrubia** — unidade comercial do produto, definida pelo Kyrub.

Medir custo do fornecedor não debita Créditos Kyrubia, não cria cobrança, não muda plano e não autoriza upgrade.

### Dados registrados por chamada generativa

- UID interno do usuário;
- `requestId` e índice da chamada;
- operação lógica;
- fornecedor e modelo que efetivamente responderam;
- rota principal/econômica/follow-up;
- indicação de fallback;
- tokens de entrada;
- tokens de conteúdo em cache quando existirem;
- tokens de saída;
- tokens de pensamento;
- tokens de uso de ferramenta quando fornecidos;
- total de tokens;
- decomposição por modalidade quando fornecida;
- service tier quando fornecido;
- snapshot de preço aplicável;
- custo estimado em micro-USD;
- timestamp server-side.

Não registrar no ledger o prompt integral, resposta integral, bytes de imagem/PDF, transcrição ou conteúdo da conversa.

### Fonte de verdade de tokens

Para Gemini `generateContent`, usar o `usageMetadata` devolvido pelo próprio provedor. O contrato contempla `promptTokenCount`, `cachedContentTokenCount`, `candidatesTokenCount`, `toolUsePromptTokenCount`, `thoughtsTokenCount`, `totalTokenCount` e detalhes por modalidade quando disponíveis.

Tokens de pensamento entram no lado de saída para cálculo de preço quando o modelo cobra pensamento como saída.

### Snapshot de preço V1

Preços verificados na documentação oficial Google AI for Developers em 13/08/2026 para o tier Standard usado pela rota atual:

- `gemini-3.6-flash`: US$ 1,50 / 1M tokens de entrada e US$ 7,50 / 1M tokens de saída;
- `gemini-3.5-flash-lite`: US$ 0,30 / 1M tokens de entrada e US$ 2,50 / 1M tokens de saída.

O snapshot inclui data de vigência e valores utilizados. Se o modelo/tier não tiver preço conhecido, a chamada continua sendo medida em tokens, mas o custo fica `unpriced` em vez de ser inventado.

Context caching possui preço próprio. Se aparecer `cachedContentTokenCount > 0` antes de termos uma tabela específica de cache, o custo deve ficar não precificado, preservando os tokens brutos para cálculo futuro.

### Observabilidade administrativa

O objetivo do Control Plane é permitir que o owner/financeiro enxergue, com fonte autoritativa:

- chamadas generativas por usuário;
- tokens por categoria;
- custo estimado do fornecedor;
- chamadas precificadas e não precificadas;
- último fornecedor/modelo/operação quando houver índice de consulta apropriado.

Storage e Firestore pertencem ao mesmo programa de metering, mas não devem aparecer como `0` antes de terem atribuição real por UID. Enquanto não instrumentados, a UI deve mostrar `medição pendente`/`não medido`.

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
