# Constituição de Produto do Kyrub

> Documento canônico de princípios de produto. Quando uma implementação, proposta comercial ou nova funcionalidade conflitar com esta Constituição, o conflito deve ser resolvido explicitamente antes de avançar.

## 1. Identidade do produto

**Kyrub** é o ecossistema: pessoas, relações, organização pessoal, trabalho, comércio, serviços, comunidades e operações convivem em uma identidade única.

**Loja Kyrub** é a presença comercial e operacional que um usuário pode **ATIVAR**. No desenho atual existe uma Loja Kyrub por usuário; Business não significa multi-loja.

**Kyrubia** é a inteligência de Kyrub. Ela conversa, interpreta objetivos, consulta contexto autorizado, propõe possibilidades e pode executar ações do domínio do Kyrub quando houver capacidade implementada, autoridade válida e controles de segurança adequados.

**Kyrub Freela** permanece o domínio de oportunidades profissionais/trabalho. Nomes comerciais novos não devem reutilizar “Oportunidades” para conceitos diferentes.

## 2. Visão orientadora

> **Kyrub deve transformar contexto em possibilidade, possibilidade em ação e ação em relacionamento. Primeiro construímos aquilo que outras partes do Kyrub podem reutilizar; depois aquilo que fecha ciclos reais; por último, features isoladas.**

O objetivo não é acumular módulos. O objetivo é formar motores reutilizáveis de aquisição, operação, descoberta, conversão, retenção, inteligência e monetização.

## 3. Princípio do comércio local

Kyrub fortalece relações e comércio locais.

- o alcance orgânico padrão da descoberta comercial começa em **5 km**;
- o consumidor pode ampliar voluntariamente a busca para distâncias maiores;
- uma Loja Kyrub pode comprar alcance adicional por mídia paga;
- anúncio pago nunca compra exclusividade sobre uma região nem suprime deliberadamente resultados orgânicos relevantes;
- toda exposição patrocinada deve ser identificada claramente;
- a relevância comercial continua obrigatória mesmo quando existe pagamento.

## 4. Uma pessoa, vários papéis

A identidade do usuário não deve ser fragmentada desnecessariamente. A mesma pessoa pode ser consumidor, proprietário de Loja Kyrub, colaborador de outra empresa, freelancer, parceiro, participante de comunidade e outros papéis.

Papéis, permissões e reputação devem ser contextuais. Uma única nota universal não deve definir a reputação da pessoa em todos os domínios.

## 5. Manual e Kyrubia coexistem

Toda capacidade importante deve, sempre que fizer sentido, poder ser operada de duas formas:

1. **modo manual**, por telas e controles explícitos;
2. **Kyrubia**, por linguagem natural e ações seguras.

Kyrubia é uma nova porta de entrada para capacidades de Kyrub, não substituição obrigatória das interfaces manuais.

## 6. Contexto não é autoridade

Memória de conversa, estado local, intenção inferida, histórico ou recomendação não concedem permissão para escrever dados críticos.

Para ações de escrita ou impacto relevante:

- o servidor é autoridade final;
- políticas determinísticas decidem `allow`, `require_confirmation` ou `deny`;
- confirmações devem refletir impacto real;
- autorizações temporárias precisam ser escopadas, expirarem e serem vinculadas ao ator;
- ações devem produzir recibos/auditoria quando apropriado;
- idempotência deve impedir duplicações acidentais;
- ações financeiras, destrutivas, públicas, de permissão ou alto impacto exigem controles adicionais.

A Constituição de Segurança e os contratos de execução prevalecem sobre conveniência de UX.

## 7. A Kyrubia resolve antes de expandir

A Kyrubia primeiro resolve o objetivo atual. Depois, se houver uma conexão realmente útil, pode apresentar uma expansão natural.

Ela não deve transformar toda conversa em venda, publicidade ou oportunidade comercial.

A **Lente de Oportunidades** deve:

- distinguir hipótese de promessa;
- nunca garantir lucro, demanda ou resultado;
- respeitar vulnerabilidade e contexto sensível;
- pedir permissão antes de transformar uma possibilidade em fluxo comercial relevante;
- preferir pequenos testes e caminhos reversíveis.

## 8. Privado primeiro; comercial somente com intenção apropriada

Conversas, notas, tarefas, eventos pessoais e objetivos privados não viram segmentação publicitária automaticamente.

Exemplo: a Kyrubia pode ajudar a planejar um aniversário numa nota privada. Um item como “encontrar topo de bolo” só deve virar busca, demanda aberta ou outra intenção comercial quando o usuário escolher essa transformação.

**Anunciantes podem comprar alcance; não podem comprar acesso às conversas privadas do usuário com a Kyrubia.**

## 9. Objetos acionáveis e continuidade entre domínios

Informação útil não deve ficar presa em ilhas. Itens de notas, listas ou planejamentos podem, mediante intenção do usuário, virar ações em outros domínios.

Exemplos:

- “Encontrar fotógrafo” → Busca;
- “Reservar salão” → Reserva/Agenda;
- “Comprar bebidas” → Marketplace;
- “Avisar João” → Tarefa;
- “Não encontrei esse serviço” → demanda aberta.

A implementação deve reutilizar domínios existentes em vez de criar módulos duplicados.

## 10. Reserva e Agenda são a mesma infraestrutura de domínio

Reserva/Agenda deve compartilhar a mesma base de disponibilidade:

- quem;
- o quê/recurso/serviço;
- data e horário;
- duração;
- disponibilidade;
- status;
- eventualmente pagamento.

A interface pode chamar de “Reserva” ou “Agenda” conforme o segmento, sem duplicar a lógica central.

## 11. Planos: capacidade, não pedágio arbitrário

V1 comercial de referência:

- **Free**: R$ 0; 5 produtos/serviços ativos; operação essencial;
- **Pro**: referência inicial R$ 79,90/mês; até 100 produtos/serviços ativos; maior capacidade operacional;
- **Business**: referência inicial R$ 199,90/mês; catálogo comercialmente ilimitado sujeito a uso justo; equipe, automações, integrações e inteligência ampliadas.

Os preços e franquias são **hipóteses comerciais V1 sujeitas a validação por dados do beta**, margem, custo e comportamento real. Não devem ser tratados como obrigação jurídica ou tabela definitiva até aprovação comercial.

Faturamento total da empresa não é trava automática de plano. Pode ser sinal de maturidade e recomendação.

Quando o Free chega ao limite de 5 itens, o próximo plano natural é **Pro**, não Business.

## 12. Kyrubia operacional e Kyrubia inteligente

Operações determinísticas que o Runtime do Kyrub consegue resolver localmente não devem consumir “créditos de IA generativa” apenas por terem sido solicitadas em linguagem natural.

A cobrança por inteligência deve refletir custo e valor de capacidades generativas/analíticas, não quantidade bruta de mensagens nem tokens de um fornecedor específico.

Referência V1 de créditos, sujeita a medição e validação:

- Free: 30 Créditos Kyrubia/mês;
- Pro: 300/mês;
- Business: 1.500/mês.

Quando créditos generativos acabarem, operações locais suportadas continuam funcionando.

## 13. Kyrubia como closer contextual

A Kyrubia pode identificar que uma necessidade ultrapassa o plano atual, mas deve recomendar **o menor plano que resolve o problema**.

Ela deve ser capaz de dizer: “O Pro já resolve o que você precisa; não há motivo para contratar Business agora.”

Upgrade deve ser explicado por valor concreto: produtos, equipe, automações, integrações, inteligência, resultado ou outra capacidade real.

## 14. Monetização alinhada a valor criado

Kyrub pode monetizar por diferentes motores sem transformar todos em mensalidade:

- assinatura Free → Pro → Business;
- Créditos Kyrubia e capacidades avançadas;
- comissão de venda efetivamente originada/intermediada pelo Kyrub;
- Kyrub Ads;
- serviços transacionais futuros (pagamentos, logística, reservas);
- Compras B2B;
- integrações e capacidades premium;
- futuramente Kyrub+ B2C, somente quando existir forte valor gratuito e recorrência.

Hipótese V1 de comissão de marketplace: Free 10%, Pro 7%, Business 5%, sujeita a validação econômica e jurídica.

Venda trazida pelo próprio comerciante e apenas registrada no ERP não deve ser tratada automaticamente como venda originada pelo Kyrub.

## 15. Kyrub Ads

Guarda-chuva de mídia paga com, inicialmente, três capacidades conceituais:

- **Expandir Alcance**: exposição patrocinada além do raio orgânico padrão;
- **Destaque na Busca**: exposição patrocinada em buscas relevantes;
- **Impulsionar**: promoção de produto, oferta ou publicação.

Kyrub Ads deve medir resultado e deixar claro quem financia cada benefício, desconto ou campanha.

## 16. Radar Kyrub

Radar Kyrub transforma dados agregados em inteligência de demanda local.

Pode responder, respeitando privacidade e limiares de agregação:

- o que está sendo procurado;
- onde há buscas sem resposta;
- quais categorias têm pouca oferta;
- onde existe demanda fora do alcance atual;
- onde o próprio Kyrub precisa adquirir novas lojas ou parceiros.

Radar nunca deve revelar quem realizou uma busca privada individual.

## 17. Demanda reversa

Busca sem resultado não precisa morrer. O usuário pode optar por registrar ou abrir sua necessidade.

Fluxo conceitual:

Busca → nenhum resultado adequado → usuário escolhe registrar/abrir demanda → fornecedores aptos podem responder no futuro.

Demanda aberta é diferente de conversa privada. A passagem entre os dois estados exige intenção explícita.

## 18. Momentos e planejamento

Com preferências e consentimentos adequados, a Kyrubia pode oferecer ajuda proativa para momentos como aniversário, casamento, viagem, reforma, mudança, formatura ou abertura de negócio.

Fluxo preferido:

Momento → planejamento privado → Nota/Tarefas → necessidades → usuário escolhe quais necessidades viram Busca/Reserva/Marketplace/demanda aberta.

A existência de um momento pessoal não concede permissão para publicidade comportamental invasiva.

## 19. Habilidade → renda

Quando houver contexto apropriado, Kyrubia pode mostrar que uma habilidade pode se tornar produto/serviço, sem publicar ou ativar negócio automaticamente.

Exemplo: “comprei uma Cricut e faço personalizados” pode gerar a pergunta opcional sobre oferecer personalizados pela Loja Kyrub.

O usuário decide se quer seguir para ativação e oferta comercial.

## 20. Capacidade ociosa → demanda

Reserva/Agenda, capacidade produtiva, Radar e Ads podem se combinar.

Exemplo: prestador possui horários vagos; existe demanda agregada próxima; Kyrubia pode sugerir ação para preencher capacidade, inclusive Expandir Alcance, sempre com autorização antes de gasto.

## 21. Fidelidade da Loja e Clube Kyrub são sistemas distintos

**Fidelidade da Loja**:

- relação Loja ↔ cliente;
- Pontos da Loja;
- benefícios financiados pela loja;
- objetivo de retenção naquela loja.

**Clube Kyrub**:

- relação Kyrub ↔ usuário;
- Créditos Kyrub e benefícios do ecossistema;
- financiamento por Kyrub, parceiros ou campanhas explícitas;
- objetivo de retenção no ecossistema.

Pontos da Loja não viram automaticamente Créditos Kyrub.

## 22. Relacionamento e memória comercial útil

Kyrub deve facilitar reencontro com fornecedores e prestadores que funcionaram bem no passado, sem aprisionar a relação.

A plataforma deve ajudar pequenos negócios a construir recorrência e confiança, não impedir o relacionamento para preservar intermediação artificial.

## 23. Comunidades Oficiais Kyrub

Comunidades oficiais pertencem ao Kyrub; Kyrubia atua como anfitriã, educadora e, futuramente, moderadora.

Elas podem apoiar onboarding, descoberta de funcionalidades e aprendizado contínuo. Participação e notificações não devem ser impostas em excesso.

## 24. Kyrub Parceiros

Guarda-chuva futuro:

- Indique e Ganhe;
- Afiliados Kyrub;
- Embaixadores Kyrub;
- Parceiros de Negócios;
- Parceiros Estratégicos.

A remuneração deve refletir valor incremental: aquisição qualificada, conversão, retenção ou implantação legítima — não mero cadastro.

### Regra antifraude central

> **Parceiros são remunerados pelo valor incremental que trouxeram ao ecossistema. Nunca por autoindicação, atribuição retroativa ou movimentação artificial entre contas relacionadas.**

Usuário pode ser comerciante e parceiro, mas sua própria Loja Kyrub é inelegível para recompensa de aquisição por autoindicação.

A cronologia e a atribuição registradas pelo Kyrub prevalecem sobre um código digitado posteriormente.

## 25. Kyrub Compras

Kyrub pode futuramente conectar estoque e velocidade de vendas a fornecedores B2B.

Fluxo conceitual:

estoque tende a acabar → Kyrubia identifica necessidade → usuário escolhe comparar fornecedores → reposição → estoque → venda.

Não transformar fornecedor patrocinado em recomendação enganosa; patrocínio deve ser identificado.

## 26. Densidade antes de escala

Para um produto local, densidade útil é mais importante que cadastros espalhados.

Kyrub deve medir se buscas relevantes encontram oferta suficiente dentro do contexto territorial esperado.

Aquisição de usuários, Lojas Kyrub, parceiros e campanhas pode ser concentrada onde uma região precisa atingir massa crítica.

## 27. Valor Gerado pelo Kyrub

No futuro, Kyrub deve conseguir demonstrar valor atribuído com transparência:

- receita originada pelo Kyrub;
- novos clientes;
- clientes recuperados;
- reservas;
- retorno de campanhas;
- automações executadas;
- redução de trabalho operacional;
- giro de estoque ou outros indicadores defensáveis.

Nenhum valor deve ser inventado. Métricas precisam de evento, atribuição e metodologia documentada.

## 28. Dados, eventos e consentimento como fundações

Antes de construir dashboards inteligentes, criar eventos e atribuição confiáveis.

Fundações importantes:

- eventos de busca, descoberta, clique, compra, reserva, campanha e retorno;
- origem de aquisição (`organic`, `partner`, `ads`, `invite` etc.);
- papéis e permissões;
- geolocalização estruturada;
- consentimentos e preferências;
- histórico/auditoria de ações;
- entitlements centralizados de planos.

Não espalhar limites comerciais em dezenas de condicionais independentes.

## 29. Centro de preferências e consentimentos

O usuário deve entender e controlar, quando aplicável:

- localização e precisão compartilhada;
- recomendações e ofertas;
- participação no Clube Kyrub;
- campanhas de lojas;
- acesso de parceiros/consultores a dados autorizados;
- uso de dados para finalidades novas.

Consentimento não deve ser usado como maquiagem para coleta desnecessária; minimização e finalidade continuam obrigatórias.

## 30. Linha do Tempo e auditabilidade

Quanto mais poder Kyrubia e equipes ganharem, mais importante será responder:

> “O que foi alterado, por quem, quando e com qual autorização?”

A Linha do Tempo deve evoluir como recurso de confiança, suporte e auditoria.

## 31. Processo de desenvolvimento e gates humanos

Nenhuma grande capacidade deve avançar de ideia diretamente para produção.

Fluxo padrão:

1. localizar a decisão no Roadmap/Constituição;
2. ler o Handoff e o estado real do código;
3. decompor em fundação e incrementos pequenos;
4. implementar com testes de contrato/segurança;
5. validar CI/build;
6. disponibilizar Preview apropriado;
7. **notificar o proprietário de que está pronto para teste humano**;
8. registrar resultado do teste;
9. corrigir regressões;
10. **pedir aprovação explícita antes de merge**;
11. observar produção após merge.

### Gates obrigatórios

- **Gate de teste humano**: quando a experiência puder ser validada no app, o proprietário deve ser chamado com roteiro objetivo de teste.
- **Gate destrutivo**: exclusões, migrações irreversíveis e alterações reais de dados exigem autorização específica.
- **Gate financeiro/comercial**: cobrança real, compra, assinatura, comissão ou gasto de Ads exigem desenho e aprovação explícitos antes de ativação.
- **Gate de produção**: merge em `main` não ocorre sem autorização explícita do proprietário.

## 32. Regra de priorização

Para cada nova ideia, perguntar:

1. fortalece o comércio e as relações locais ou o núcleo de organização/operabilidade de Kyrub?
2. resolve um problema real?
3. existe alguém que recebe valor claro e, quando aplicável, alguém disposto a pagar?
4. reutiliza ou fortalece uma fundação já existente?
5. fecha um ciclo real ou é apenas uma feature isolada?

Quando houver conflito de prioridade:

**fundação reutilizável > ciclo completo de valor > feature isolada.**

## 33. Fontes complementares

Esta Constituição deve ser lida junto com:

- `docs/ARCHITECTURE.md`;
- `docs/KYRUBIA.md`;
- `docs/AI_USAGE_GOVERNANCE.md`;
- `docs/PRIVACY_SECURITY_READINESS.md`;
- `docs/RELEASE_CHECKLIST.md`;
- Constituição-as-Code e contratos de segurança existentes no projeto.

A Constituição de Produto descreve direção e invariantes de produto; o código e os testes continuam sendo a fonte de verdade do que está efetivamente implementado.