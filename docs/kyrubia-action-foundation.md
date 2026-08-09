# Fundação de ações da Kyrubia

## Finalidade

A Kyrubia é a inteligência nativa do Kyrub. Ela deve ajudar pessoas e negócios a transformar conversas, imagens, PDFs, planilhas e outros materiais em dados estruturados e ações seguras dentro do aplicativo.

A fundação não é limitada a restaurantes. Ela deve atender cardápios, pet shops, moda, comércio geral, serviços e futuros segmentos sem duplicar as regras do ERP.

## Princípio central

A inteligência interpreta o pedido. O Kyrub autentica, autoriza, apresenta a proposta, recebe a confirmação e executa a operação.

Nenhum modelo de IA recebe acesso direto e irrestrito ao Firestore. Mutações originadas pela Kyrubia passam pela fronteira de execução segura do servidor e pelos serviços oficiais do Kyrub.

## Camada compartilhada

A mesma camada de ações deverá atender:

- Kyrubia dentro do aplicativo;
- integração futura do Kyrub com o ChatGPT;
- comandos de voz;
- automações autorizadas;
- modo manual do ERP.

Cada execução registra origem, usuário, tipo de ação, chave de idempotência, entidade afetada e resultado.

## Etapas

### 1. Fundação

- protocolo compartilhado de ações;
- confirmação obrigatória para mutações;
- idempotência;
- auditoria;
- substituição das pontes que automatizam a interface por serviços oficiais.

### 2. Leitura do ERP

- resumo da loja;
- produtos e variações;
- estoque baixo;
- pedidos pendentes;
- informações necessárias para responder sem inventar dados.

### 3. Escrita segura

- produto como rascunho;
- atualização de produto;
- categorias e variações;
- ofertas;
- ajustes de estoque com confirmação reforçada.

### 4. Catálogo multimodal

- envio de imagens e PDFs na conversa;
- análise genérica de catálogo;
- dúvidas e campos não resolvidos;
- revisão em lote;
- importação idempotente como rascunho;
- publicação somente após nova confirmação.

## Primeiro serviço oficial

A criação de notas é a primeira ação migrada. A Kyrubia não localiza botões, placeholders ou formulários no DOM para executar a operação.

Na versão inicial, a gravação ainda era realizada por um action service no navegador. A Safe Execution Foundation move a mutação originada pela Kyrubia para uma rota autenticada do servidor: o cliente apresenta o draft, obtém confirmação, envia a proposta e o Firebase ID token, e o backend valida policy antes de fazer o commit.

O identificador da ação gera um documento determinístico. Repetições da mesma confirmação com a mesma proposta retornam o resultado existente, sem criar notas duplicadas. Reutilizar a mesma chave com conteúdo diferente é rejeitado.

## Fronteira de execução segura

A especificação detalhada está em `docs/kyrubia-safe-execution-foundation.md`.

A sequência de referência é:

```text
proposta estruturada
      ↓
proveniência + impacto
      ↓
Policy Engine determinístico
      ↓
confirmação ou delegação válida
      ↓
Execution Envelope vinculado ao hash da proposta
      ↓
Executor oficial
      ↓
recibo de execução
```

A proveniência informa de onde veio o conteúdo; ela não concede autoridade por si só. Conteúdo observado, citado, extraído de documento ou produzido por modelo pode alimentar um draft, mas uma mutação não pode nascer silenciosamente dessa observação.

Permissão também não implica escala. Cada capability declara um blast radius permitido, e o servidor recalcula o impacto que ele próprio pode determinar em vez de confiar em valores enviados pelo cliente.

## Segurança

- usuário Firebase obrigatório;
- identidade revalidada no servidor para mutações originadas pela Kyrubia;
- escrita apenas no espaço pertencente ao usuário ou à loja autorizada;
- Policy Engine determinístico e sem LLM;
- confirmação exigida conforme capability e impacto;
- ações sensíveis com comparação antes/depois quando aplicável;
- nenhum preço, estoque ou informação comercial inventado;
- rascunho antes de publicação;
- registro de origem `kyrubia`, `chatgpt`, `manual` ou `automation`;
- blast radius limitado por capability;
- proposta autorizada vinculada por hash ao Execution Envelope;
- recibo mínimo gravado junto da execução quando aplicável.
