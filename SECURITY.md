# Política de segurança

## Comunicação responsável

Não publique em issue, pull request, captura ou discussão pública:

- chaves e tokens;
- credenciais Firebase Admin;
- dados pessoais;
- documentos de identidade;
- conteúdo privado de mensagens ou notas;
- payloads de webhooks reais;
- detalhes suficientes para explorar uma vulnerabilidade ativa.

Relate vulnerabilidades diretamente ao responsável pelo projeto por um canal privado previamente acordado. Caso o canal ainda não esteja publicado, interrompa a divulgação técnica e contate o proprietário do repositório sem incluir o segredo ou a prova explorável na primeira mensagem.

## Informações úteis no relato

- superfície afetada;
- ambiente;
- impacto possível;
- passos mínimos de reprodução usando dados de teste;
- requisito de autenticação;
- regra, endpoint ou componente relacionado;
- mitigação temporária conhecida;
- evidências sanitizadas.

## Prioridade

- **Crítica:** acesso indevido, exposição de dados, credencial válida, execução remota, bypass administrativo, alteração financeira ou perda ampla.
- **Alta:** autorização incorreta, leitura cruzada entre contas, upload perigoso, webhook sem validação ou ação crítica sem confirmação.
- **Média:** abuso com impacto limitado, rate limit ausente, informação operacional excessiva.
- **Baixa:** hardening, cabeçalhos ou comportamento sem exploração prática demonstrada.

## Resposta

O projeto deve:

1. confirmar recebimento;
2. classificar e conter;
3. preservar evidências;
4. corrigir em branch restrita quando necessário;
5. adicionar teste de regressão;
6. rotacionar credenciais afetadas;
7. revisar impacto e comunicação obrigatória;
8. divulgar detalhes apenas depois da mitigação.

## Escopo sensível

Atenção especial para:

- regras Firestore e Storage;
- documentos `users`, lojas, equipes e diretórios;
- Control Plane administrativo;
- Firebase ID tokens;
- funções em `api/`;
- credenciais de integrações;
- filas, webhooks e idempotência;
- notas, mensagens e colaboração;
- Kyrubia e tool calls;
- upload, Drive e Photos;
- migrações e reconciliação de estoque.

## Segredos encontrados no histórico

Não basta remover o texto do arquivo. O valor deve ser considerado comprometido, revogado e substituído. Depois, avalie limpeza de histórico conforme impacto e coordene o procedimento sem republicar o segredo.
