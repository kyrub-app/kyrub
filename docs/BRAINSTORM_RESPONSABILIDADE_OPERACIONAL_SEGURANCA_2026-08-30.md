# Kyrub — Brainstorm consolidado: Responsabilidade Operacional, Delivery, Segurança e Monetização

Data de consolidação: 2026-08-30

Este documento preserva as decisões, hipóteses, princípios e questões em aberto surgidas durante o brainstorm sobre o fluxo de pedidos, KDS, entrega, espera remunerada, responsabilidade operacional, segurança, reputação profissional, monetização e administração do Kyrub.

Ele complementa `ROADMAP_PROXIMOS_AJUSTES.md`. Não substitui políticas jurídicas/comerciais versionadas nem autoriza merge, produção, movimentação financeira, custódia ou integração PSP específica.

---

## 1. Princípio central do Motor de Responsabilidade

O Kyrub não deve decidir culpa por um cronômetro isolado, um clique isolado ou uma única leitura de GPS.

Princípio operacional:

> Atraso não é culpa. Movimento não é cumprimento. Parada não é abandono.

A cadeia canônica deve permanecer:

`Raw Operational Evidence → Responsibility Attribution → Billable Waiting Decision → Economic Obligation → Eligibility → Funding → Settlement → Reconciliation`

Responsabilidade operacional e consequência econômica são camadas distintas. Um fato pode existir sem gerar cobrança. Uma responsabilidade pode ser atribuída sem criar automaticamente dívida. Uma obrigação econômica somente nasce de decisão faturável aprovada e autoridade econômica adequada.

Atores possíveis de responsabilidade:

- `store`
- `courier`
- `customer`
- `external`
- `undetermined`

Casos ambíguos não devem ser chamados automaticamente de fraude; devem ir para revisão quando necessário.

---

## 2. Fluxo macro do pedido com entrega

Fluxo de referência:

`Cliente escolhe loja → adiciona itens → escolhe entrega → endereço → confirma pedido → pagamento/autoridade financeira → loja aceita → pedido entra no KDS → chega a vez na fila → Iniciar preparo → oportunidade de entrega publicada → entregador inicia coleta → deslocamento até loja → chegada corroborada → coleta segura → deslocamento ao cliente → chegada corroborada → entrega segura → confirmação`

A ordem exata da captura/cobrança do cliente continua dependente do fluxo financeiro/PSP e não deve ser inferida pelo frontend.

Quando a loja marca `Iniciar preparo`, a oportunidade de entrega pode ser publicada imediatamente, mesmo que o item ainda não esteja pronto.

O objetivo de produto é permitir que os dois lados acompanhem relógios complementares:

- entregador acompanha previsão de preparo do pedido;
- KDS/loja acompanha ETA do entregador até a coleta.

Visualmente, a oportunidade pode mostrar barra/timer de evolução do preparo e o KDS pode mostrar barra/timer/ETA de aproximação do entregador.

---

## 3. Tempo de preparo: ficha técnica, capacidade e fila

O tempo técnico de preparo deve vir da ficha técnica/item da vitrine e não ser alterado manualmente para maquiar atraso de um pedido em andamento.

Separar conceitualmente:

- `productionTime`: duração técnica/configurada do produto;
- `queueDelay`: atraso provocado pela carga/capacidade atual da operação;
- `promisedReadyAt`: previsão derivada para aquele pedido naquele momento.

Exemplo de hamburgueria: um hambúrguer pode ter 10 minutos de produção, mas uma chapa cheia com vários pedidos à frente aumenta a previsão real daquele novo pedido. O problema não é alterar o tempo técnico do hambúrguer; é calcular adequadamente capacidade e fila.

O KDS deve evoluir para considerar carga produtiva, capacidade e pedidos simultâneos. No futuro, histórico real por produto, loja, horário e dia pode melhorar a previsão.

Uma vez iniciado o preparo, a previsão/snapshot operacional daquele pedido não deve ser retroativamente editada para apagar atraso.

O tempo técnico da ficha pode ser alterado para pedidos futuros se a própria ficha/processo produtivo mudar, mas pedidos já iniciados preservam o snapshot vigente.

---

## 4. Quem pode marcar “Pedido pronto”

Somente o perfil/staff que tenha a tarefa/permissão operacional de finalização/expedição no KDS.

Referência de restaurante: pessoa que finaliza, embala, lacra/fecha, associa nota/comanda e disponibiliza fisicamente o pedido para coleta.

`store_marked_ready` é uma declaração operacional importante, mas não deve ser tratado como prova econômica absoluta por si só.

Se a loja marca pronto e o entregador permanece corroboradamente presente por muito tempo antes da coleta segura, existe divergência entre `ready_claim` e `secure_pickup`, que pode exigir corroboracão/revisão.

---

## 5. Oportunidades de entrega e filtros

Todas as oportunidades compatíveis podem aparecer no painel do profissional, ordenadas inteligentemente.

O usuário pode filtrar por:

- distância;
- tipo de entrega/serviço;
- alimentos;
- produtos físicos;
- carreto/frete;
- modalidade de veículo;
- futuramente transporte de passageiros, se juridicamente e operacionalmente autorizado;
- outras modalidades que surgirem no ecossistema.

Uma oportunidade pode aparecer na lista mesmo que o usuário não seja elegível para aceitá-la, desde que a UI deixe claro o requisito. Exemplo: frete de geladeira pode ser visualizado por usuário de bicicleta, mas só pode ser aceito por quem tenha veículo/modalidade compatível cadastrado e validado.

O profissional escolhe e cadastra seus veículos. Cada modalidade pode exigir documentos próprios e validação correspondente.

Hipótese inicial de operação discutida: raio máximo de 7 km entre posição do entregador e loja para aproximação/coleta, e até 7 km entre loja e cliente para a entrega, total operacional potencial de aproximadamente 14 km. Essa hipótese deve ser política configurável/versionada e não constante escondida no código.

---

## 6. Informações exibidas antes e depois do aceite

Antes de aceitar/iniciar coleta, o card deve fornecer informação suficiente para decisão consciente:

- estabelecimento/local de coleta;
- distância aproximada do entregador até a loja;
- bairro/região de destino;
- distância aproximada loja → cliente;
- modalidade necessária;
- previsão de preparo;
- remuneração/componentes aplicáveis.

O endereço residencial completo do cliente não deve ser mostrado antes do compromisso.

Depois de `Iniciar coleta`, o entregador assume compromisso e passa a receber o endereço/dados necessários à execução.

A oportunidade desaparece imediatamente do painel dos demais profissionais quando aceita. Se houver cancelamento/reatribuição, ela volta a ficar elegível para outros.

---

## 7. Aceitar/Iniciar coleta significa compromisso

A filosofia favorece o profissional, mas autonomia não elimina responsabilidade pelo compromisso aceito.

Depois de `Iniciar coleta`, espera-se que o entregador prossiga em direção à loja e execute aquela entrega, sem assumir outro trabalho incompatível enquanto mantém o compromisso Kyrub.

Desvio grosseiro, afastamento persistente ou comportamento incompatível com a rota pode levar a reatribuição. Pequenos desvios, trânsito e variações normais não devem gerar punição automática.

O sistema deve observar:

- distância;
- direção;
- velocidade/progresso;
- histórico da rota;
- trânsito/condições externas quando disponíveis;
- proximidade real do destino;
- resposta do entregador a alertas;
- incidentes declarados/corroborados.

Se o ETA estourou, mas o profissional está efetivamente chegando, o sistema deve ser flexível e preservar a atribuição em vez de cancelar de forma cega.

---

## 8. Reatribuição inteligente

Não usar regra simplista `ETA + X = cancelamento`.

Avaliação conceitual:

- ETA excedido + aproximação consistente → estender;
- ETA excedido + quase chegando → preservar atribuição;
- ETA excedido + parado → investigar/contextualizar;
- ETA excedido + afastando-se → risco de abandono/desvio;
- excesso significativo + sem progresso + sem resposta → candidato a reatribuição.

A mesma telemetria pode alimentar Responsabilidade Operacional e Segurança, mas os dois motores não devem ser confundidos.

---

## 9. Espera na loja

Se o entregador chega e o pedido não está pronto, ele deve aguardar dentro das regras da plataforma. Não haverá mecanismo normal de “sair para fazer outra corrida e voltar mantendo a espera”.

A presença física/corroborada é requisito para contabilizar espera.

Se o entregador sair da geofence, o período externo não pode ser contado como espera na loja.

Depois do limite/tolerância previsto em política, o entregador poderá desistir sem a mesma consequência de abandono injustificado e seguir para outra oportunidade. Se houver espera remunerável legítima antes da desistência, somente o período elegível efetivamente comprovado pode ser considerado.

Tempos de tolerância discutidos ao longo do brainstorm são hipóteses de produto e devem ser política versionada, nunca fallback hardcoded.

---

## 10. Proteção da loja contra coleta tardia

A proteção é simétrica.

Depois que o pedido está de fato pronto/disponível, um entregador que demora injustificadamente para coletar pode prejudicar a qualidade do produto, gerar pedido frio/deteriorado, reclamação, troca ou reembolso.

Cadeia operacional relevante:

`pedido pronto corroborado → janela de coleta → entregador ausente/afastando-se/sem progresso → atraso de coleta → risco de qualidade → eventual dano`

O sistema pode reofertar/reatribuir a entrega quando o entregador excede uma janela de coleta de forma injustificada.

Não descontar automaticamente dinheiro do profissional apenas por atraso. Consequência financeira por dano deve exigir política própria e evidência adequada, por exemplo relação entre coleta tardia atribuível e reembolso/troca.

Produtos perecíveis podem futuramente ter `qualityWindow`/classe de urgência diferente de produtos secos/não perecíveis.

---

## 11. Chegada do entregador antes do pedido/loja

Pode acontecer de o entregador estar muito perto e chegar praticamente junto com a entrada/aceite do pedido.

A chegada precoce causada pelo despacho não deve gerar automaticamente responsabilidade econômica da loja se ela ainda estiver dentro da janela legítima de produção.

No futuro, o despacho deve tentar sincronizar:

`ETA do preparo ≈ ETA do entregador`

A meta é reduzir espera, não apenas remunerá-la.

---

## 12. Cancelamento pelo entregador

O profissional pode cancelar; ninguém é obrigado a continuar diante de imprevistos. Porém, depois do compromisso, o impacto do cancelamento deve ser considerado.

Decisão refinada:

- antes do aceite, recusar/ignorar oportunidades não gera punição;
- após `Iniciar coleta`, existe pequena janela de arrependimento sem consequência, discutida em torno de 15–20 segundos, porque o endereço completo só é revelado após o compromisso e pode existir informação legítima que mude a decisão;
- após essa janela, consequência deve ser proporcional ao impacto;
- cancelamento muito depois, perto do pedido ficar pronto ou após deslocamento significativo, pode gerar indisponibilidade temporária para iniciar nova coleta;
- incidentes justificados não devem ser tratados como abandono;
- reincidência pode agravar a consequência;
- não usar multiplicador infinito sem teto; trabalhar com faixas/políticas transparentes.

Fatores de impacto:

- tempo desde o aceite;
- distância/progresso já realizado;
- proximidade do `promisedReadyAt`;
- se já chegou à loja;
- facilidade/tempo de substituição;
- dano operacional causado;
- reincidência no período;
- existência de justificativa/incidente.

Hipótese discutida: indisponibilidade temporária pode refletir aproximadamente o impacto/tempo residual do compromisso rompido, com agravamento por padrão recorrente. Fórmula final continua em aberto e deve ser política versionada.

---

## 13. Remuneração da entrega: componentes separados

Não misturar todos os valores em uma única “taxa de entrega”.

Componentes conceituais:

- `pickup_approach`: aproximação do ponto do entregador até a loja;
- `delivery_base`: piso/base da entrega, quando aplicável;
- `delivery_distance`: distância loja → cliente;
- `waiting`: espera remunerada elegível;
- `return_trip`: retorno exigido;
- `extraordinary_costs`: pedágio, balsa, estacionamento ou outros custos elegíveis;
- subsídios/incentivos adicionais quando política permitir.

Ideia do proprietário: o cliente paga o trecho loja → cliente e o lojista pode financiar incentivo de aproximação/coleta para que o profissional não rode até a loja “de graça”. Foi discutida hipótese de R$ 5 de aproximação, mas esse valor não deve ser hardcoded antes de política econômica final.

Também foi discutida referência sindical/legislativa de remuneração mínima e R$/km. A fórmula final deve ser validada contra legislação/propostas vigentes e transformada em política econômica versionada, não constante de código.

Pedágio, balsa, estacionamento e custos extraordinários devem ser componentes explícitos, preferencialmente financiados pelo cliente quando diretamente necessários à execução, conforme política e informação prévia adequada.

---

## 14. Cliente ausente na entrega

Princípio discutido:

- chegada precisa ser corroborada; clique “cheguei” isolado não é suficiente para gerar cobrança;
- primeiros 2 minutos foram definidos como tolerância gratuita de referência;
- após isso, iniciar tentativas de contato;
- limite total de permanência discutido: cerca de 10 minutos desde a chegada;
- não manter o entregador esperando indefinidamente;
- espera remunerada deve ter teto/política própria;
- cliente deve receber notificações de aproximação, proximidade e chegada.

Tentativas de contato podem começar automatizadas e escalar para equipe humana quando necessário.

Ao atingir limite sem resposta, a ação sobre o produto depende da política do item/estabelecimento:

- descarte/liberação autorizada;
- retorno obrigatório à loja;
- outro procedimento específico por categoria.

Se a loja exigir retorno, esse retorno deve gerar trecho econômico separado (`return_trip`) e ser remunerado. A fonte de financiamento/recuperação econômica deve ser política própria e não presumida como custo automático do Kyrub.

Quando a não entrega for responsabilidade comprovada do cliente, a loja não deve ser tratada automaticamente como responsável pelo prejuízo.

---

## 15. Incidentes e evidências

Podem abrir incidente:

- cliente;
- loja;
- entregador;
- sistema;
- Admin.

Uma abertura é uma `claim`/alegação, não verdade automática.

Permitir evidências como:

- foto;
- áudio;
- vídeo;
- telemetria;
- timestamps de servidor;
- geofence;
- ações autenticadas;
- coleta/entrega segura;
- notificações e confirmações quando autoritativas.

Mídia exige política de armazenamento, privacidade, moderação, retenção e acesso.

---

## 16. Reputação Profissional Kyrub

Uma identidade Kyrub pode possuir múltiplos papéis profissionais/social-operacionais, cada um com reputação própria.

Exemplos:

- consumidor;
- entregador;
- garçom;
- cabeleireiro;
- comerciante;
- freelancer;
- outras profissões/serviços.

Não misturar desempenho de um papel com outro. Uma pessoa pode ser excelente em uma atividade e ruim em outra.

Separar obrigatoriamente:

### Avaliação social/humana

- estrelas ou outro formato;
- comentários;
- percepção de cliente/loja/profissional;
- avaliação bilateral/multilateral.

### Indicadores operacionais

- pontualidade;
- conclusão;
- abandono;
- compromissos cumpridos;
- incidências justificadas;
- desempenho objetivo/corroborado.

Não condensar tudo em uma “nota misteriosa” de algoritmo.

A metáfora discutida foi uma “ficha de RPG profissional”: identidade única, papéis, atributos, progressão, histórico e conquistas. Pode conversar com gamificação, barras de progresso, multiplicadores/seqüências de consistência (`x1`, `x2`, `x3` etc.), badges, vouchers e campanhas.

Consequências operacionais relevantes devem ser explicáveis. Evitar reduzir oportunidades secretamente sem mostrar regra/fato ao profissional.

Dados sensíveis, incidentes, localização, documentos e Safety Cases não entram automaticamente em perfil público. Visibilidade deve ser por campo/categoria e política.

---

## 17. Avaliação bilateral e rede social

Todos os lados podem avaliar experiências relevantes:

- cliente → entregador/profissional;
- entregador → cliente;
- loja → entregador;
- entregador → loja/coleta;
- outros papéis conforme contexto.

A visão é uma rede em que usuários se conectam, avaliam e constroem reputação por atividade, preservando distinção entre opinião social e fatos operacionais.

---

## 18. Segurança Kyrub: escopo global

O sistema de segurança não deve ser exclusivo de entregadores.

Nome conceitual: `Segurança Kyrub` / `Kyrub Safety`.

O entregador é o primeiro caso de uso porque já possui telemetria ativa durante deslocamento, mas a arquitetura deve servir a qualquer usuário e atividade relevante:

- entregadores;
- prestadores/freelancers;
- técnicos em atendimento externo;
- profissionais em serviço domiciliar;
- motoristas/passageiros, se aplicável futuramente;
- usuários comuns em situações de segurança.

Responsabilidade Operacional pergunta: “o que aconteceu com a operação?”

Segurança Kyrub pergunta: “essa pessoa está bem?”

Os motores podem compartilhar telemetria, mas não podem confundir punição com proteção.

---

## 19. Safety Check automático

Exemplo de gatilho: usuário/entregador permanece anormalmente parado durante atividade que deveria ter progressão de rota.

Primeira abordagem:

> “Percebemos que você está parado há algum tempo. Está tudo bem?”

Opções sugeridas:

- Estou bem;
- Problema com a entrega/atividade;
- Tive um imprevisto/acidente;
- Preciso de ajuda.

Ausência de resposta pode gerar novas tentativas e escalonamento progressivo.

Nunca assumir emergência apenas por GPS parado. Possíveis falsos positivos incluem trânsito, túnel, perda de sinal, GPS travado, bateria, parada necessária ou indisponibilidade temporária.

Primeira versão de escalonamento:

`anomalia → Safety Check → novas tentativas → Admin Segurança + contato de emergência`

Acionamento automático de polícia/SAMU/bombeiros fica fora da primeira fase e exige avaliação jurídica/operacional e sinais muito mais fortes.

---

## 20. Contatos de emergência

Para ativação do perfil de entregador, pelo menos um contato de emergência válido será obrigatório.

Para outros usuários/papéis, política pode variar futuramente.

Regras definidas:

- contato não precisa ser usuário Kyrub;
- contato precisa aceitar formalmente a função;
- usuário e contato podem encerrar o vínculo;
- quando o contato sair, titular é notificado e deve escolher substituto quando o papel exigir contato obrigatório;
- permitir múltiplos contatos;
- permitir prioridade/ordenação;
- compartilhamento de localização/informações depende de autorização prévia e política explícita.

Mensagem de escalonamento deve ser neutra e não fabricar emergência:

> “O Kyrub tentou confirmar se [pessoa] está bem durante uma atividade e não recebeu resposta. Você está cadastrado como contato de emergência. Consegue verificar se está tudo bem?”

Última localização conhecida pode ser compartilhada conforme consentimento e estágio do Safety Case.

---

## 21. Botão de emergência global

Desenhar botão/atalho de segurança acessível em áreas importantes do aplicativo, não apenas durante entregas.

Hipótese de UX discutida: pequeno ícone em posição de baixo risco de toque acidental, como região média esquerda da tela em mobile. Não congelar posição sem teste de acessibilidade/usabilidade sob estresse.

Primeira versão sugerida:

- abrir Safety Case manual;
- registrar localização autorizada;
- oferecer contato rápido com contato(s) de emergência;
- alertar Central de Segurança/Admin;
- manter trilha de auditoria.

Não acionar serviço público automaticamente nesta fase.

---

## 22. Central humana de Segurança

Equipe humana poderá receber alertas de Safety Cases e acompanhar ocorrências.

Localização em tempo real durante um caso de segurança pode ser visível apenas quando:

- Safety Case está ativo;
- existe motivo registrado;
- acesso é autorizado pela política;
- acesso fica auditado;
- permissão expira/é encerrada com o caso.

Nenhum operador/IA deve ter acesso irrestrito permanente à localização de todos os usuários.

---

## 23. Retenção de GPS e dados sensíveis

Não usar uma única regra “guardar para sempre” nem simplesmente deixar toda retenção obrigatória a critério do usuário.

Separar classes:

- telemetria operacional bruta;
- histórico opcional do usuário;
- evidência de entrega;
- evidência econômica;
- incidentes;
- Safety Cases;
- auditoria de acesso.

Cada classe pode ter retenção distinta conforme finalidade, consentimento, necessidade operacional, obrigação jurídica, contestação e `legal hold` documentado.

Preferências do usuário podem controlar dados opcionais e reciclagem quando permitido, mas não anulam automaticamente obrigações legítimas de retenção.

Criptografia é necessária para dados sensíveis, mas não justifica retenção excessiva por si só. Estratégia de armazenamento/criptografia/segregação deve ser desenhada com segurança e LGPD.

---

## 24. Transparência e governança

Princípio do proprietário:

> Plataforma aberta/transparente, mas as regras operacionais da plataforma não são decididas por votação.

Tradução de produto:

- regras são definidas pela plataforma e políticas versionadas;
- usuário consegue saber qual regra foi aplicada;
- fatos relevantes usados em consequência devem ser explicáveis;
- quando cabível, existe contestação/revisão;
- evitar algoritmos secretos que alterem renda/elegibilidade sem explicação;
- decisões críticas não são “democráticas”, mas devem ser auditáveis e governadas.

---

## 25. Admin como Centro de Operações

`admin.kyrub` deve evoluir de dashboard passivo para centro de operações em tempo real.

Módulo `Responsabilidade Operacional`:

- timeline por entrega;
- pronto declarado;
- chegada geofence;
- tentativa de coleta;
- coleta segura;
- aproximação do cliente;
- chegada;
- entrega confirmada;
- incidentes;
- intervalos atribuídos;
- casos ambíguos/revisão;
- reatribuições.

Módulo `Segurança`:

- Safety Cases;
- anomalias;
- checks enviados/respondidos;
- escalonamentos;
- contato de emergência;
- acessos de localização auditados.

Métricas futuras:

- precisão de “pedido pronto” por loja;
- eficiência de coleta por entregador;
- padrões de atraso;
- prontidão do cliente para receber;
- casos inconclusivos;
- espera remunerada validada/inválida.

---

## 26. Agentes de IA no Admin

Visão: maior parte dos operadores do painel pode ser assistida por agentes especializados, com humanos em decisões críticas.

Agentes possíveis:

- logística;
- risco/fraude;
- economia/pagamentos;
- infra/custos;
- suporte;
- compliance;
- segurança;
- coordenador.

Permissão inicial: `read + recommend`.

Depois, ações seguras/reversíveis podem evoluir para `execute_with_policy`.

Ações críticas exigem humano/política estrita, como:

- bloquear conta;
- movimentar dinheiro;
- mudar política econômica;
- excluir dados;
- decisões sensíveis de settlement;
- escalonamentos graves de segurança.

n8n pode ser orquestrador de integrações/workflows, mas não fonte canônica das regras econômicas/operacionais do Kyrub.

Central futura de Agentes deve mostrar acesso, ações, recomendações, custos de IA, erros, acurácia, escalonamentos e permissões.

---

## 27. Platform fee, receita Kyrub e reserva operacional

Não confundir:

- frete/taxa de entrega do profissional;
- `platform_fee` do Kyrub;
- receita;
- caixa;
- reserva;
- orçamento;
- saldo custodial.

A visão financeira discutida é split/routing direto via PSP/marketplace sempre que permitido, evitando Kyrub custodiar dinheiro de loja/profissional.

A `platform_fee` é receita do Kyrub, não remuneração do entregador.

Exemplos de valores discutidos são ilustrativos e não devem ser hardcoded.

A receita própria do Kyrub pode futuramente ser alocada internamente, por política, em categorias como:

- `operational_reserve`;
- `delivery_subsidy`;
- `professional_safety_campaign`;
- `professional_equipment_campaign`;
- `promotional_incentive`;
- `marketing`;
- `partnership`;
- `retained`.

Exemplos de uso: subsídio parcial de frete, mochilas, capacetes, coletes/jaquetas, caneleiras, luvas, equipamentos de segurança e benefícios para profissionais do ecossistema.

Campanha/equipamento financiado pela receita do Kyrub é despesa/benefício corporativo, não saldo individual devido a profissional, salvo quando existir award/entitlement explícito.

---

## 28. Reserva operacional e garantia

Evitar modelar assinatura/taxa do lojista como “depósito preso” ou carteira do lojista.

Preferência arquitetônica:

- assinatura/platform fee = receita Kyrub;
- Kyrub pode provisionar recursos próprios para reserva de proteção operacional;
- se política de garantia estiver ativa, Kyrub pode antecipar/garantir obrigação legítima de profissional usando fundos próprios;
- depois nasce recebível contra responsável e a recuperação repõe a reserva.

Cadeia possível:

`responsabilidade validada → obrigação do profissional → garantia Kyrub → recebível Kyrub contra responsável → cobrança → recomposição da reserva`

Garantia não está automaticamente habilitada. Requer limites de exposição, funding evidence autoritativa e política específica.

---

## 29. Cobrança diferida

Quando espera/cancelamento nasce depois do pagamento original, não reescrever/falsificar o pagamento antigo.

Estratégias futuras possíveis:

- `next_transaction`;
- `direct_collection`;
- `platform_guarantee`.

Se uma transação posterior quitar dívida anterior, ela deve referenciar a nova transação PSP e a obrigação antiga.

Capacidade real depende do PSP, consentimento, modalidade de pagamento e legislação.

Pix já concluído não pode ser simplesmente “aumentado”. Débito suplementar/preauth/stored credential depende de rail autorizado.

---

## 30. PSP Qualification Owner Gate

Antes de implementação de split/cobrança real, comparar documentação e contrato vigentes de provedores, incluindo Mercado Pago, PagBank/PagSeguro, Efí e outros adequados.

Verificar:

- marketplace/split/subcontas;
- destinatários;
- 1:1 e 1:N;
- cobrança de passivo anterior em nova transação;
- stored credentials/MIT/recorrência;
- preauth/captura incremental;
- Pix/boleto;
- webhooks/statements/reconciliation;
- white-label/onboarding/KYC;
- assinatura Pro;
- custos e suporte.

Isso é Owner Gate antes de código provider-specific irreversível.

---

## 31. Decisões técnicas atuais — PRs empilhadas

Bloco de espera remunerada/responsabilidade está sendo desenvolvido em PRs empilhadas sem merge automático.

Sequência relevante:

- #424 — evidência de espera física;
- #425 — snapshot de política de espera;
- #426 — obrigação de espera (legado da cadeia anterior, a ser gated pela decisão de responsabilidade);
- #427 — elegibilidade;
- #428 — linhas separadas em Renda;
- #429 — funding responsibility;
- #430 — superfícies read-only de funding;
- #431 — contrato de funding evidence para settlement;
- #432 — contrato de evidência/responsabilidade operacional;
- #433 — avaliação de responsabilidade;
- #434 — decisão separada de espera faturável.

Correção arquitetônica já aplicada em #432/#433:

- responsabilidade não carrega `economicallyBillable`;
- responsabilidade não usa `confidence high/medium/low` subjetivo;
- usa evidência `authoritative | corroborated | review_required`;
- casos sem evidência suficiente ficam `undetermined/review_required`;
- chegada de cliente declarada apenas por courier não basta para cobrar cliente;
- defaults comerciais não ficam escondidos no contrato.

Próximo passo técnico:

- obrigação de espera do #426 deve nascer somente de uma `DeliveryBillableWaitingDecision` aprovada;
- preservar evidência física bruta mesmo quando não faturável;
- depois adicionar persistência de eventos operacionais autoritativos e integrar ready/geofence/pickup/customer events;
- customer waiting deve ser obrigação separada da store waiting;
- não criar wallet/custódia visual.

---

## 32. Questões futuras/Owner Gates preservadas

Ainda precisam de política/decisão específica, sem bloquear o contrato atual:

- fórmula final da remuneração de aproximação até a loja;
- piso/minimum fare conforme legislação/negociação vigente;
- tarifa por km e modalidades;
- raio de 7 km como regra definitiva ou configurável por modalidade/região;
- janela exata de arrependimento pós-aceite (15–20 s foi hipótese);
- faixas/teto de inelegibilidade por cancelamento recorrente;
- janela de coleta após pedido pronto;
- quality windows por categoria;
- detalhes do cálculo de capacidade/fila do KDS;
- política de retorno/descarte por categoria;
- funding/recuperação de espera do cliente;
- períodos concretos de retenção de GPS/dados;
- requisitos jurídicos de Safety;
- PSP final e rails disponíveis;
- regras de transporte de passageiros se futuramente permitido;
- visibilidade pública detalhada da ficha/reputação profissional.

---

## 33. Regra de preservação deste documento

Novas decisões relevantes desse domínio devem ser adicionadas aqui ou em documento sucessor referenciado explicitamente.

Não apagar hipóteses históricas silenciosamente: quando uma decisão mudar, registrar a substituição e a razão.

Nenhuma menção a valor, tempo, raio ou punição neste documento deve ser tratada automaticamente como constante de código. Sempre distinguir:

- princípio de produto;
- hipótese de brainstorm;
- política aprovada/versionada;
- implementação técnica;
- regra jurídica/comercial vigente.
