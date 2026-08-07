# Fundação de ações da Kyrubia

## Finalidade

A Kyrubia é a inteligência nativa do Kyrub. Ela deve ajudar pessoas e negócios a transformar conversas, imagens, PDFs, planilhas e outros materiais em dados estruturados e ações seguras dentro do aplicativo.

A fundação não é limitada a restaurantes. Ela deve atender cardápios, pet shops, moda, comércio geral, serviços e futuros segmentos sem duplicar as regras do ERP.

## Princípio central

A inteligência interpreta o pedido. O Kyrub autentica, autoriza, apresenta a proposta, recebe a confirmação e executa a operação.

Nenhum modelo de IA recebe acesso direto e irrestrito ao Firestore. Todas as mutações passam por serviços oficiais do Kyrub.

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

A criação de notas é a primeira ação migrada. A Kyrubia deixa de localizar botões, placeholders e formulários no DOM. Após a confirmação, um serviço oficial grava a nota privada no caminho do usuário e o listener existente atualiza a interface.

O identificador da ação gera um documento determinístico. Repetições da mesma confirmação retornam o resultado existente, sem criar notas duplicadas.

## Segurança

- usuário Firebase obrigatório;
- escrita apenas no espaço pertencente ao usuário ou à loja autorizada;
- ações sensíveis com comparação antes/depois;
- nenhum preço, estoque ou informação comercial inventado;
- rascunho antes de publicação;
- registro de origem `kyrubia`, `chatgpt`, `manual` ou `automation`.
