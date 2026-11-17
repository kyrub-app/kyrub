# Kyrubia Educadora — primeira etapa de integração

## Objetivo

Usar o chat já existente da **Kyrubia Educadora** para escolher uma meta de aprendizagem, gerar um pedido editável e continuar a conversa. O usuário permanece no controle do envio. Nenhum LMS novo, endpoint de cadastro, matrícula, cobrança ou certificado é criado nesta etapa.

## Trilhas existentes

- **Aprender para gerar renda**: competências e prática.
- **Aprender a empreender**: vendas, precificação, caixa e organização.
- **Aprender a usar o Kyrub**: domínio manual do app e do ERP.

A escolha abre uma conversa existente com título próprio e rascunho inicial que o usuário pode revisar. O histórico da Educadora continua sendo tratado pela mesma infraestrutura de conversas da Kyrubia.

## Catálogo externo — ainda não liberado

Inventário documental consultado em 31/10/2026 (fonte: `inventario_cursos_kyrub.xlsx`):

| Classificação documental | Registros | Condição informada |
| --- | ---: | --- |
| Acervo 1 | 197 | Sem repasse por venda, matrícula e certificado |
| Acervo 2 | 1.091 | R$ 20 por aluno faturável/mês; sujeito a confirmação operacional |
| Acervo 3 | 0 identificados | Repasse variável por curso; sem oferta confirmada |
| Não identificado | 3 | Não publicar como gratuitos |
| Total | 1.291 | Classificação do fornecedor não existe como campo explícito nos registros |

Os três títulos sem vínculo seguro são `4 P'S do Marketing`, `Vender na Internet` e `Gestão de Pessoas`. A classificação dos 197 registros do Acervo 1 é **provisória**; não publicar ou matricular automaticamente sem confirmação oficial por ID.

## Gates para integrar o fornecedor

1. Confirmar catálogo e classificação por ID, custos e validade das licenças.
2. Verificar APIs reais para conta/aluno, matrícula, cancelamento, progresso e certificados, com testes isolados.
3. Implementar links/sessões autenticadas apenas com autorização adequada; nunca divulgar tokens em URL ou cliente.
4. Validar no ambiente isolado e depois na rodada E2E final de usuário; autorização explícita antes de dados/cobranças reais.

O ERP, CRM, marketplace, social e os planos continuam sob autoridade do Kyrub. **Esta PR não representa que o catálogo Kyrub Cursos já está integrado**.
