# Prontidão de privacidade e segurança

## Aviso

Este documento é um checklist técnico e operacional. Ele não substitui revisão jurídica nem constitui política de privacidade final.

## Dados tratados pelo produto

O inventário deve considerar, conforme o recurso utilizado:

- identificadores Firebase e Google;
- nome, e-mail e foto;
- endereço e contato informados;
- perfil social, conexões, mensagens e publicações;
- lojas, produtos, pedidos e estoque;
- notas, checklists, lembretes e colaboradores;
- mídias e arquivos;
- dados de operação e auditoria;
- prompts, respostas e ações da Kyrubia;
- credenciais de integração armazenadas de forma protegida;
- documentos ou biometria apenas quando existir backend e base legal aprovados.

## Princípios técnicos

- minimização: armazenar apenas o necessário;
- finalidade: cada campo tem uso documentado;
- isolamento: dados privados não entram em diretórios públicos;
- transparência: simulações e recursos planejados são identificados;
- segurança por servidor: autorização não depende apenas da interface;
- retenção: dados não permanecem indefinidamente sem motivo;
- auditabilidade: ações críticas têm registro;
- reversibilidade: usuário consegue corrigir ou solicitar exclusão.

## Antes do beta externo

- [ ] mapear todas as coleções e campos pessoais;
- [ ] definir controlador, operadores e canal de contato;
- [ ] aprovar termos de uso;
- [ ] aprovar política de privacidade;
- [ ] definir bases legais e finalidades;
- [ ] definir idade mínima e tratamento de menores;
- [ ] definir retenção por categoria;
- [ ] definir fluxo de acesso, correção, portabilidade e exclusão;
- [ ] definir denúncia, bloqueio e moderação;
- [ ] revisar transferências internacionais e fornecedores;
- [ ] revisar consentimentos de Google, Gemini, Firebase, Vercel e integrações;
- [ ] definir resposta a incidentes e responsáveis.

## Exclusão de conta

A exclusão não deve ser implementada como um simples `deleteUser()` no navegador.

O fluxo precisa decidir e testar:

1. reautenticação;
2. cancelamento de assinatura e integrações;
3. transferência ou encerramento de loja/equipe;
4. tratamento de pedidos e registros legais;
5. remoção ou anonimização de perfil público;
6. mensagens e notas compartilhadas;
7. mídias no Storage;
8. documentos privados do Firestore;
9. credenciais de integração;
10. logs e backups sujeitos a retenção;
11. exclusão final da identidade Firebase;
12. confirmação e trilha da solicitação.

Até esse fluxo estar aprovado, a interface deve oferecer canal de solicitação e não prometer exclusão instantânea total.

## Perfil, KYC e biometria

O código possui elementos de demonstração para segurança, verificação, KYC e biometria. Eles não podem ser apresentados como validação real até existirem:

- fornecedor e contrato;
- backend seguro;
- criptografia e controle de acesso;
- base legal específica;
- retenção e descarte;
- avaliação de risco;
- revisão jurídica;
- processo de contestação e suporte.

Nenhum documento real deve ser solicitado por uma simulação local.

## Mensagens e conteúdo social

Antes de ampliar a rede:

- bloquear usuário;
- denunciar usuário, publicação e mensagem;
- impedir contato após bloqueio;
- limitar spam e automação;
- preservar evidência apenas pelo período necessário;
- definir resposta a conteúdo ilegal ou risco imediato;
- disponibilizar regras da comunidade.

## Kyrubia

- informar que respostas podem conter erros;
- não enviar segredos ou documentos sensíveis sem finalidade e proteção;
- limitar contexto ao necessário;
- registrar metadados de uso sem conteúdo integral por padrão;
- permitir revisão antes de ações;
- não usar conversas para finalidade nova sem transparência;
- definir retenção e acesso de suporte.

## Fornecedores

Manter inventário de:

- Firebase / Google Cloud;
- Gemini;
- Vercel;
- serviços de mídia;
- integrações de entrega, marketplace ou pagamento;
- futuro provedor de monitoramento;
- futuro processador de cobrança.

Para cada fornecedor: finalidade, dados enviados, região, contrato, retenção, subprocessadores, incidente e exclusão.

## Backups

- definir coleções e buckets incluídos;
- criptografar e restringir acesso;
- separar produção de teste;
- definir frequência e retenção;
- testar restauração, não apenas criação;
- registrar restauração em ambiente isolado;
- garantir que exclusões alcancem backups ao fim da retenção definida.

## Evidências de prontidão

A aprovação deve produzir:

- inventário de dados;
- diagrama de fluxo;
- matriz de acesso;
- políticas publicadas;
- testes de regras;
- registro de fornecedores;
- plano de incidente;
- teste de restauração;
- teste de exclusão;
- responsável e data da próxima revisão.
