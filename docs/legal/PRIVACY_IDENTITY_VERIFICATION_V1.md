# Verificação proporcional de identidade — procedimento candidato
Não publicado. Requer revisão jurídica, responsável designado, canal seguro e homologação operacional. Aplica-se a pedidos de direitos, não a ocorrências SOS.

## Rotas
- Conta existente: reautenticação recente e associação anterior ao protocolo, verificada pelo servidor. A prova de controle não comprova identidade civil, representação ou direito a dados de terceiros.
- CID: desafio WebAuthn novo, vinculado ao protocolo, credencial e titularidade vigentes; associação anterior à solicitação. Não exigir conta Kyrub. Se a Tag estiver bloqueada, a passkey perdida ou o vínculo não puder ser confirmado, oferecer atendimento alternativo.
- Terceiros sem conta, representantes ou casos inconclusivos: atendimento individual pelo canal funcional de privacidade, sem cadastro compulsório. Comprovação de controle do canal é evidência de contato, não prova suficiente de titularidade de todos os dados.

## Procedimento de análise individual
1. Registrar protocolo, direito, contexto e informação mínima necessária para localizar o tratamento. Não solicitar documentos ou dados sensíveis no formulário inicial.
2. Avaliar a natureza do pedido, risco de divulgação indevida, relação com o tratamento, elementos já disponíveis, possíveis terceiros e representação. Informar o que é necessário e por quê.
3. Preferir meios de menor intrusão: prova de controle de conta/CID já associado, confirmação de fatos conhecidos pelo solicitante e verificáveis pelo controlador sem revelar dados, ou atendimento humano por canal seguro. Não usar perguntas baseadas em dados públicos como prova isolada.
4. Se houver necessidade demonstrada de comprovação adicional, utilizar canal restrito, acesso mínimo, finalidade específica e prazo de descarte aprovado. Não solicitar senha, código de recuperação, token de sessão, biometria ou documento completo por chat público. Não impor CPF ou documento como regra universal. Representantes devem ter poderes adequados verificados proporcionalmente.
5. Registrar método, resultado, responsável, data, justificativa, escopo e prazo da prova, sem replicar documentos desnecessariamente. Resultado insuficiente: explicar pendência de forma segura, oferecer alternativa e preservar o protocolo. Não revelar se existe cadastro de outra pessoa.
6. Analisar o direito e a legitimidade por finalidade e categoria de dados; segregar terceiros, retenções legais e limitações aplicáveis. Não confundir confirmação de identidade com autorização automática de exportação, alteração ou exclusão.
7. Acompanhar prazos desde o recebimento, sem reiniciar automaticamente o relógio por pendências de identificação. A equipe jurídica define tratamento de prazos conforme hipótese; confirmação/acesso simplificados ou completos conforme LGPD art. 19. Não inventar prazo universal.
8. Entregar resposta por meio seguro, informar fundamentos e alternativas quando necessário, registrar decisão, comunicação e descarte de evidência temporária conforme política aprovada.

## Limites atuais
PR #1390 comprova controle de conta no Auth local; PR de CID reutiliza verificador WebAuthn no projeto demo-kyrub-privacy, com associação fictícia previamente estabelecida. Nenhuma prova de identidade civil, canal público efetivo, fluxo de representação, entrega segura, integração de produção ou atendimento real está implementada. O procedimento individual é documental. Antes de liberar, definir critérios por direito, canal alternativo acessível, equipe, segurança, retenção, auditoria e testes de ponta a ponta. Não bloquear o exercício de direitos por ausência de conta ou falha de passkey.
