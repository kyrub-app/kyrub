# Changelog

Mudanças relevantes do Kyrub são registradas neste arquivo. O projeto utiliza desenvolvimento contínuo e pull requests; datas representam incorporação ao produto.

## Não publicado

### Adicionado

- barreira global de recuperação para falhas fatais do cliente;
- código de incidente sanitizado para diagnóstico;
- endpoint geral `/api/health` sem exposição de segredos;
- contrato automatizado de prontidão do MVP;
- documentação de arquitetura, ambientes, beta, release, incidentes, IA, privacidade e segurança.

### Alterado

- README inicial do AI Studio substituído por documentação oficial do Kyrub.

## 2026-08-01 — Kyrubia e fechamento do núcleo

### Adicionado

- identidade oficial da Kyrubia;
- lente de oportunidades;
- criação confirmada de notas e checklists;
- continuidade de conversa após aceite da exploração;
- cabeçalho persistente e rolagem segura no chat;
- tratamento específico de falhas do Gemini;
- endpoint autossuficiente da Kyrubia para produção.

### Corrigido

- configuração incompatível de function calling do Gemini;
- repetição de nota após respostas afirmativas curtas;
- perda do botão de saída em conversas extensas ou mensagens de limite;
- rolagem da proposta de nota/checklist.

## Histórico anterior

O histórico completo de evolução técnica permanece nos commits e pull requests do repositório. Novas releases devem acrescentar uma seção resumindo impacto para usuário, segurança, migrações e operação.
