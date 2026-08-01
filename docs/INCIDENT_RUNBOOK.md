# Runbook de incidentes

## Objetivo

Restabelecer o Kyrub com segurança, preservar evidências e evitar que a resposta ao incidente cause uma segunda falha.

## Classificação

- **SEV-0:** exposição de dados, acesso indevido, perda ampla, cobrança ou operação financeira incorreta.
- **SEV-1:** login, aplicação ou fluxo essencial indisponível para muitos usuários.
- **SEV-2:** funcionalidade importante degradada, com alternativa segura.
- **SEV-3:** falha localizada ou de acabamento.

## Primeiros 15 minutos

1. registrar horário, ambiente, release e sintoma;
2. confirmar se o problema é geral ou de uma conta;
3. consultar `/api/health` e o diagnóstico específico do serviço;
4. revisar logs sem copiar segredos ou dados pessoais;
5. interromper deploys concorrentes;
6. desabilitar integração ou feature flag quando houver risco;
7. fazer rollback quando a release atual for a causa provável.

## Informações mínimas

- domínio e ambiente;
- commit/release;
- rota afetada;
- código HTTP;
- código de erro do Kyrub;
- código de incidente exibido no cliente;
- quantidade aproximada de usuários afetados;
- primeira e última ocorrência;
- fornecedor envolvido;
- ação de contenção.

## Falha do cliente React

Sintoma: tela de recuperação “Algo inesperado interrompeu esta tela”.

1. registrar o código `KYR-*`;
2. tentar recarregar;
3. validar o mesmo fluxo em sessão limpa;
4. procurar `[Kyrub Client Error]` nos logs do navegador ou serviço de monitoramento;
5. localizar o componente pelo `componentStack`;
6. adicionar teste de regressão antes de publicar a correção.

A barreira não captura todos os erros assíncronos. Falhas de rede e eventos devem continuar sendo tratadas no próprio fluxo.

## Falha da Kyrubia

1. consultar `GET /api/kyrubia`;
2. confirmar `configured` e `model`;
3. revisar o corpo da resposta do POST e os logs da função;
4. diferenciar:
   - chave ausente ou recusada;
   - modelo indisponível;
   - cota/rate limit;
   - erro de formato;
   - autenticação Firebase indisponível;
   - conexão com o provedor;
5. manter o modo manual disponível;
6. nunca trocar modelo ou chave às cegas em produção.

## Falha Firebase

1. confirmar Auth, Firestore e Storage separadamente;
2. verificar regras e índices recém-publicados;
3. confirmar projeto e ambiente;
4. distinguir leitura do cache de confirmação do servidor;
5. não apagar caches do usuário antes de preservar escritas pendentes;
6. usar emulador para reproduzir autorização antes de alterar regra.

## Mistura ou exposição de dados

1. tratar como SEV-0;
2. interromper o fluxo afetado;
3. revogar acesso ou credencial comprometida;
4. preservar logs de auditoria;
5. identificar coleções, documentos e período;
6. não editar manualmente evidências sem cópia controlada;
7. acionar responsável por privacidade/jurídico;
8. avaliar comunicação obrigatória aos titulares e autoridades.

## Integrações e webhooks

1. pausar polling, scheduler ou conexão por tenant;
2. confirmar assinatura e segredo do webhook;
3. verificar idempotência e fila de entrada;
4. não reenviar eventos sem avaliar duplicação;
5. reconciliar pedidos e estoque após restabelecimento;
6. registrar divergências antes de corrigir.

## Encerramento

Um incidente só é encerrado quando:

- serviço e dados foram validados;
- impacto foi medido;
- causa raiz foi registrada;
- teste de regressão existe quando aplicável;
- ação preventiva tem responsável;
- credenciais temporárias foram revogadas;
- comunicação necessária foi concluída.

## Pós-incidente

Documentar de forma não punitiva:

- o que aconteceu;
- por que as proteções não impediram;
- como foi detectado;
- como foi contido;
- o que reduziu ou ampliou o impacto;
- ações com prazo e responsável.
