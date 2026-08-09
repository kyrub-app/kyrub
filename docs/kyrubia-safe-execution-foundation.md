# Kyrubia Safe Execution Foundation

## Finalidade

Esta fundação estabelece a fronteira entre a inteligência probabilística da Kyrubia e as mutações oficiais do Kyrub.

O objetivo não é liberar novas capacidades de escrita. Nesta primeira versão, a única mutação existente, `create_note`, é usada como caso controlado para provar a arquitetura antes de qualquer ação sobre produtos, estoque, pedidos, dinheiro ou outros estados operacionais.

## Princípios operacionais

### Modelo interpreta; Kyrub executa

Modelos de IA podem interpretar linguagem, organizar conteúdo e preparar propostas estruturadas. Eles não recebem acesso direto aos métodos de commit do domínio.

O cliente da Kyrubia também não é o executor oficial. Após a confirmação, ele envia uma solicitação autenticada ao backend confiável do Kyrub.

### Conteúdo observado não é comando

Texto citado, documentos, respostas de ferramentas, conteúdo gerado por IA e inferências de sensores podem informar uma proposta, mas não concedem autoridade de execução por si mesmos.

A proveniência da proposta é preservada. Quando ela não é conhecida, o sistema assume de forma conservadora `ai_generated_content`, nunca `user_intent` por conveniência.

Uma confirmação humana nova pode autorizar a proposta exata que foi apresentada para revisão. Isso permite, por exemplo, transformar futuramente um documento ou uma imagem em um rascunho e salvar o resultado após revisão, sem transformar o conteúdo observado em comando automático.

### Permissão não implica escala

Cada capability declara um limite de entidades afetáveis. O Policy Engine compara o impacto calculado pelo servidor com esse limite.

O cliente não é autoridade sobre o próprio blast radius: para `create_note`, o servidor recalcula o impacto canônico independentemente dos valores recebidos na requisição.

Valores concretos de limite são política de implementação, não princípios constitucionais permanentes.

### Policy Engine é determinístico e model-free

O Policy Engine roda na fronteira confiável do servidor e não chama Gemini, OpenAI ou qualquer outro LLM.

Ele avalia, entre outros fatores:

- identidade autenticada;
- permissão exigida pela capability;
- confirmação quando necessária;
- proveniência da proposta;
- validade do impacto;
- blast radius permitido.

As decisões possíveis nesta versão são:

- `allow`;
- `require_confirmation`;
- `deny`.

### Autorização pertence à proposta, não ao modelo

Quando uma operação é autorizada, o executor cria um `ExecutionEnvelope` com:

- ator;
- action ID e action type;
- origem;
- proveniência;
- impacto;
- decisão de policy;
- modo e instante da autorização;
- validade temporal;
- chave de idempotência;
- hash SHA-256 da proposta normalizada.

Alterar conteúdo, título, checklist ou qualquer parte canônica da proposta altera seu hash. Uma autorização não deve ser reaproveitada como autorização vaga para outro payload.

### Executor oficial continua protegendo o domínio

Policy não substitui invariantes do domínio. O Executor recebe somente a ação já normalizada e autorizada, fixa o tenant/alvo a partir da identidade autenticada e usa os serviços confiáveis do servidor para realizar a mutação.

No caso de `create_note`, o destino é derivado exclusivamente do UID verificado pelo Firebase Admin. O cliente não escolhe outro usuário como destino.

Para futuras atualizações de estados existentes, o Executor também deverá revalidar a verdade operacional imediatamente antes do commit e rejeitar propostas obsoletas quando as premissas tiverem mudado.

> Policy decide se pode. Executor garante que ainda pode.

## Fluxo implementado para `create_note`

```text
mensagem / raciocínio
        ↓
proposta create_note
        ↓
UI mostra o draft
        ↓
usuário confirma
        ↓
cliente obtém Firebase ID token
        ↓
POST /api/actions/execute
        ↓
Firebase Admin verifica identidade
        ↓
servidor normaliza proposta e impacto
        ↓
Policy Engine
        ↓
Execution Envelope + proposalHash
        ↓
transação oficial do servidor
   ↙                         ↘
nota do usuário       recibo mínimo de execução
```

O navegador não usa `runTransaction()` nem `firebase/firestore` para executar a ação da Kyrubia.

O modo manual de criação de notas permanece separado e disponível.

## Idempotência

A confirmação gera uma chave determinística quando nenhuma chave explícita foi fornecida.

Se a mesma ação chegar novamente com a mesma chave e o mesmo hash, o executor retorna `already_applied` em vez de criar outra nota.

Se a mesma chave for reutilizada com payload diferente, a execução é rejeitada como conflito de idempotência.

## Recibo de execução

A mesma transação que cria a nota grava um recibo mínimo em `kyrub_action_receipts/{executionId}`.

O recibo registra fatos de execução, incluindo ator, capability, origem, proveniência, impacto, hash da proposta, decisão de policy, autorização, alvo e resultado.

Esta camada é a semente da futura Audit Foundation. Ela ainda não pretende ser o arquivo imutável de longo prazo. A arquitetura futura poderá enviar esses recibos para armazenamento append-only e sistemas analíticos sem colocar o histórico completo no hot path do ERP.

> Toda execução deixa um recibo.
>
> Auditoria registra fatos, não pensamentos.

## Constitution Contracts

Os princípios constitucionais relevantes devem possuir invariantes executáveis no CI.

Nesta fundação, testes impedem regressões como:

- contexto ou memória virar autorização;
- cliente da Kyrubia voltar a escrever diretamente no Firestore;
- proposta sem confirmação atravessar uma mutação que exige confirmação;
- conteúdo observado ganhar autoridade automaticamente;
- blast radius declarado pelo cliente ser tratado como verdade;
- permissão ignorar limite de escala;
- Execution Envelope deixar de estar vinculado ao hash da proposta;
- executor deixar de validar a identidade Firebase antes do commit.

A Constituição permanece o documento humano de princípios. Os contracts são barreiras executáveis que verificam invariantes concretas derivadas desses princípios.

## Limites desta versão

Esta PR deliberadamente não habilita:

- criação ou atualização automática de produtos;
- ajuste de estoque;
- alteração de loja;
- ações financeiras;
- autonomia pré-delegada;
- execução em nome de terceiros;
- roteamento logístico;
- arquivo de auditoria imutável de longo prazo.

Essas capacidades deverão reutilizar a mesma fronteira de proposal → policy → authorization → execution, adicionando políticas específicas e revalidação de estado quando forem implementadas.
