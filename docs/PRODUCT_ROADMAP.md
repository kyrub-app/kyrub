# Roadmap Estratégico do Kyrub

> Documento-mãe de direção e checklist. **Não confundir item planejado com funcionalidade já implementada.** O estado executável atual deve ser confirmado no código, testes, PRs e `docs/DEVELOPMENT_HANDOFF.md`.

## Convenções

- `[ ]` planejado / pendente;
- `[~]` em andamento;
- `[x]` entregue e validado;
- `[!]` bloqueado / exige decisão;
- preços, franquias e comissões marcados como V1 são hipóteses sujeitas a validação econômica/jurídica antes de cobrança real.

## Horizonte A — AGORA: conhecimento oficial antes de ampliar a Kyrubia

### Mudança de prioridade — 2026-08-10

A expansão conversacional “frase por frase” da Kyrubia fica **pausada**. A fundação segura já criada não será descartada. O objetivo agora é dar à Kyrubia fontes explícitas de verdade e contexto antes de ensiná-la a responder novos assuntos do produto.

- [x] Comunidades multiusuário já existem na `main` desde a PR #137: mural, Debates, comentários, membros, moderação e capa no Firebase.
- [~] PR #154: fundação de **Conhecimento Oficial + Observabilidade Semântica**.
- [ ] Criar/definir o perfil oficial Kyrub que será âncora de autoria confiável.
- [ ] Criar manualmente a primeira **Comunidade Oficial Kyrub**.
- [ ] Criar manualmente de 3 a 5 conteúdos reais de FAQ/explicação antes de qualquer geração automática.
- [ ] Na fase inicial, utilizar Debates oficiais como artigos estruturados: título = assunto/pergunta; conteúdo = explicação oficial; `open` = vigente; `closed` = retirado.
- [ ] Garantir que somente conteúdo produzido pelo perfil oficial em comunidades explicitamente configuradas seja considerado conhecimento oficial.
- [ ] Nunca tratar comentários, conteúdo de membros ou um booleano gravado pelo cliente como verdade oficial.
- [ ] Criar recuperação/busca determinística da base oficial.
- [ ] Criar eventos semânticos de navegação, tentativa e resultado, sem despejar logs técnicos brutos na Kyrubia.
- [ ] Instrumentar algumas jornadas reais do app com eventos estruturados depois que o contrato estiver validado.
- [ ] Só então conectar a Kyrubia como **leitora** de: conhecimento oficial + estado real do usuário + contexto recente.
- [ ] A Kyrubia não pode alterar silenciosamente conhecimento oficial; edição/publicação continua humana até existir governança específica.
- [ ] Evoluir posteriormente a aba **Avisos** das Comunidades para uma experiência editorial própria de conteúdo oficial, se isso trouxer ganho real sobre a convenção inicial de Debates.

### Princípio desta fase

> **A Kyrubia não precisa ter o Kyrub inteiro decorado. Ela precisa saber onde está a verdade, enxergar o que está acontecendo e ter permissão segura para agir.**

## Horizonte A.1 — PR #152 preservada, mas expansão conversacional pausada

A PR #152 permanece Draft, não mergeada. O trabalho seguro de execução continua válido, mas novas frases/respostas específicas não são a prioridade enquanto a camada de conhecimento não existir.

- [x] Fundação segura para ativação de Loja Kyrub e criação de produto.
- [x] Enforcement server-side de capacidade Free.
- [x] Handoff comercial Free → Pro no limite de catálogo.
- [x] Catálogo comercial V1 determinístico para perguntas sobre Free/Pro/Business.
- [x] Próximos Passos Estruturados/chips com `authorization: intent_only`.
- [x] “Então explica” pode aceitar uma única oferta conversacional anterior sem Gemini.
- [~] Workflow sequencial de múltiplos produtos implementado tecnicamente; validação humana completa ainda depende de capacidade controlada para dois itens.
- [!] Perguntas operacionais não cobertas ainda podem cair no Gemini; não continuar criando regex/rotas assunto por assunto antes da nova base de conhecimento.
- [ ] Retomar #152 depois da primeira fundação de Conhecimento Oficial/Observabilidade e decidir o mínimo necessário para concluir/mergear a PR.
- [ ] Não fazer merge de #152 sem autorização explícita.

## Horizonte B — Fundações transversais

- [ ] Centralizar planos, permissões e limites em uma camada de entitlements.
- [ ] Modelar Free → Pro → Business sem condicionais comerciais espalhadas.
- [~] Estruturar eventos semânticos reutilizáveis; fundação iniciada na PR #154.
- [ ] Evoluir eventos de busca, descoberta, clique, compra, reserva, campanha, ação da Kyrubia e retorno de cliente.
- [ ] Distinguir sempre **navegação**, **tentativa/intenção** e **resultado confirmado**.
- [ ] Não considerar clique como prova de sucesso; resultado confirmado pelo domínio/servidor prevalece.
- [ ] Criar modelo de atribuição de aquisição: `organic`, `partner`, `ads`, `invite` e futuras fontes.
- [ ] Planejar/registrar `firstTouchAt`, `partnerId`, `referralCode`, `qualifiedAt`, `convertedAt` quando aplicável.
- [ ] Evoluir geolocalização como infraestrutura central.
- [ ] Adotar 5 km como raio orgânico padrão de descoberta local.
- [ ] Estruturar papéis e permissões para uma pessoa com vários papéis.
- [ ] Criar base para reputação contextual/grafo de confiança.
- [ ] Evoluir Linha do Tempo de Atividades/auditoria.
- [ ] Planejar Centro de Preferências e Consentimentos.
- [ ] Garantir que contexto privado da Kyrubia não vire publicidade automaticamente.

## Horizonte C — Planos e monetização V1

- [ ] Free: R$ 0; 5 produtos/serviços ativos.
- [ ] Pro: hipótese R$ 79,90/mês; até 100 produtos/serviços ativos.
- [ ] Business: hipótese R$ 199,90/mês; catálogo comercialmente ilimitado com uso justo e maior capacidade operacional.
- [ ] Medir custo real da Kyrubia antes de consolidar franquias finais.
- [ ] Referência de Créditos Kyrubia: Free 30, Pro 300, Business 1.500/mês.
- [ ] Operações locais/determinísticas da Kyrubia não consomem crédito generativo.
- [ ] Fazer Kyrubia recomendar o menor plano suficiente.
- [ ] Não usar faturamento total como trava automática.
- [ ] Estudar comissão somente para vendas originadas/intermediadas pelo Kyrub; hipótese Free 10%, Pro 7%, Business 5%.
- [ ] Criar futuramente indicador de **Valor Gerado pelo Kyrub**.

## Horizonte D — Kyrub Ads

- [ ] Criar guarda-chuva Kyrub Ads separado dos planos.
- [ ] Criar **Expandir Alcance** para exposição patrocinada além do raio orgânico.
- [ ] Preservar liberdade do consumidor para ampliar sua própria busca organicamente.
- [ ] Identificar todo conteúdo patrocinado.
- [ ] Criar futuramente Destaque na Busca.
- [ ] Criar futuramente Impulsionar produto/oferta/publicação.
- [ ] Medir impressões, cliques, visitas e conversões atribuíveis com metodologia transparente.
- [ ] Relacionar Ads a disponibilidade, demanda, localização e catálogo.
- [ ] Nunca vender acesso a conversas privadas como segmentação publicitária.

## Horizonte E — Radar Kyrub

- [ ] Detectar buscas sem resposta e demanda local agregada.
- [ ] Mostrar lacunas de oferta sem revelar identidade dos usuários.
- [ ] Conectar Radar a catálogo, estoque, Ads e expansão territorial.
- [ ] Criar mapa de lacunas comerciais por região.
- [ ] Usar Radar internamente para orientar aquisição de lojas e parceiros.
- [ ] Explorar inteligência econômica local para empreendedores, fornecedores e associações, com limiares de privacidade.

## Horizonte F — Demanda reversa

- [ ] Quando uma busca falhar, oferecer “registrar/abrir o que estou procurando”.
- [ ] Separar demanda comercial explicitamente aberta de contexto privado.
- [ ] Permitir futuramente que fornecedores aptos respondam à demanda.
- [ ] Fazer buscas frustradas melhorarem a oferta futura via Radar.

## Horizonte G — Momentos e objetos acionáveis

- [ ] Permitir sugestões proativas consentidas para aniversário, casamento, viagem, reforma, mudança, formatura, abertura de negócio e outros momentos.
- [ ] Criar planejamento privado em Nota/Tarefas antes de qualquer ação comercial.
- [ ] Permitir converter itens escolhidos pelo usuário em Busca, Reserva, Marketplace, Tarefa ou demanda aberta.
- [ ] Criar infraestrutura de objetos acionáveis reutilizável, sem módulo específico para cada evento.

## Horizonte H — Motores de valor

- [ ] **Planejamento → Comércio**: Momento → Kyrubia → Nota/Tarefa → necessidade → Busca/Reserva/Loja Kyrub.
- [ ] **Demanda → Nova Oferta**: busca não atendida → Radar → comerciante → novo produto/serviço.
- [ ] **Habilidade → Renda**: habilidade contextual → Kyrubia oferece possibilidade → usuário decide → Loja Kyrub → oferta.
- [ ] **Capacidade Ociosa → Demanda**: Agenda/capacidade → Radar → ação/Ads → venda/reserva.
- [ ] **Compra → Relacionamento → Novo Momento**: compra/reserva → fidelidade/rede → recorrência.

## Horizonte I — Reserva / Agenda

- [ ] Evoluir o Reserva existente no ERP para infraestrutura geral de agenda/disponibilidade.
- [ ] Reutilizar mesmo domínio para restaurante, clínica, prestador, oficina, profissional etc.
- [ ] Modelar quem, recurso/serviço, data, horário, duração, disponibilidade, status e eventual pagamento.
- [ ] Tornar Reserva/Agenda operável manualmente e pela Kyrubia com segurança.
- [ ] Conectar horários vagos a Radar/Ads sem gasto automático.

## Horizonte J — Fidelidade da Loja

- [ ] Criar pontos pertencentes à relação Loja ↔ cliente.
- [ ] Criar recompensas, cupons, níveis, missões e campanhas.
- [ ] Segmentar, quando autorizado, recorrentes, inativos, aniversariantes e outros grupos.
- [ ] Deixar explícito quem financia cada benefício.
- [ ] Usar Fidelidade para retenção dentro daquela loja.

## Horizonte K — Clube Kyrub

- [ ] Manter separado da Fidelidade da Loja.
- [ ] Criar Créditos Kyrub e benefícios do ecossistema.
- [ ] Criar missões, badges e recompensas.
- [ ] Permitir campanhas financiadas por Kyrub/parceiros de forma explícita.
- [ ] Não converter automaticamente Pontos da Loja em Créditos Kyrub.
- [ ] Usar Clube Kyrub para retenção dentro da plataforma.

## Horizonte L — Ofertas Kyrub (nome de trabalho)

- [ ] Evitar “Kyrub Oportunidades” por conflito semântico.
- [ ] Detectar estoque parado/baixa saída/excesso.
- [ ] Kyrubia sugere oferta sem alterar preço sem autorização.
- [ ] Criar descoberta local de ofertas.
- [ ] Conectar a Kyrub Ads · Impulsionar.

## Horizonte M — Comunidades Oficiais Kyrub

- [x] Infraestrutura de Comunidades multiusuário entregue pela PR #137.
- [~] Reorientar Comunidades como interface humana também para Conhecimento Oficial.
- [ ] Criar comunidades oficiais pelo perfil Kyrub.
- [ ] Manter criação inicial dos conteúdos **manual**, não automática pela Kyrubia.
- [ ] Usar conteúdo oficial para onboarding contínuo e, futuramente, grounding da Kyrubia.
- [ ] Avaliar “Comece pelo Kyrub”, “Kyrubia na prática”, “Venda mais com sua Loja Kyrub”, “Kyrub Freela” e “Comunidade Kyrub”.
- [ ] Kyrubia atua como anfitriã/educadora e, futuramente, moderadora **somente depois** da governança da fonte estar estabelecida.
- [ ] Conectar missões educativas ao Clube Kyrub quando fizer sentido.
- [ ] Evitar inscrições/notificações excessivas por padrão.

## Horizonte N — Kyrub Parceiros

- [ ] Indique e Ganhe.
- [ ] Afiliados Kyrub.
- [ ] Embaixadores Kyrub.
- [ ] Parceiros de Negócios para empresas com carteira própria, como RH, contadores, consultorias e agências.
- [ ] Parceiros Estratégicos para grandes acordos.
- [ ] Remunerar aquisição/valor qualificado, não cadastro vazio.
- [ ] Permitir que Kyrubia faça onboarding depois que o parceiro abre a porta.
- [ ] Testar pequenos pilotos antes de automatizar comissões complexas.

## Horizonte O — Antifraude de parceiros

- [ ] Proibir autoindicação.
- [ ] Proibir recompensa de aquisição pela própria Loja Kyrub.
- [ ] Não reatribuir usuário orgânico retroativamente a parceiro.
- [ ] Manter cronologia da aquisição como fonte de verdade.
- [ ] Diferenciar aquisição de serviço de implantação/consultoria.
- [ ] Permitir comerciante-parceiro indicar legitimamente outros negócios.
- [ ] Nunca remunerar recrutamento de afiliados por si só.

## Horizonte P — Kyrub Compras

- [ ] Planejar marketplace B2B de reposição.
- [ ] Relacionar estoque/velocidade de venda a necessidade de reposição.
- [ ] Comparar fornecedores regionais futuramente.
- [ ] Estudar comissão B2B, leads, assinatura de fornecedor e Ads.

## Horizonte Q — Grafo de confiança

- [ ] Uma identidade, múltiplos papéis.
- [ ] Reputação contextual por domínio.
- [ ] Usar sinais verificáveis e legítimos, evitando nota universal simplista.
- [ ] Reutilizar em Marketplace, Freela, Reserva, Comunidades, Parceiros e antifraude.

## Horizonte R — Comércio local coordenado

- [ ] Explorar campanhas conjuntas entre Lojas Kyrub próximas.
- [ ] Explorar benefícios cruzados via Clube Kyrub.
- [ ] Permitir futuramente experiências combinando produtos/serviços de negócios diferentes.
- [ ] Ajudar pequenos negócios independentes a funcionar como rede local coordenada.

## Horizonte S — Densidade antes de escala

- [ ] Medir cobertura útil de buscas dentro do contexto local.
- [ ] Identificar bairros/cidades/segmentos onde concentrar aquisição.
- [ ] Usar Radar, Ads, Parceiros e Embaixadores para corrigir lacunas de oferta.
- [ ] Avaliar restaurantes e outros segmentos como aceleradores de densidade sem verticalizar todo o produto.

## Horizonte T — Expansão futura

- [ ] Kyrub+ B2C somente após forte recorrência gratuita.
- [ ] Kyrub Pay quando houver infraestrutura, parceiro, segurança e revisão jurídica adequados.
- [ ] Entregas/logística.
- [ ] Compras B2B avançadas.
- [ ] Inteligência econômica local.
- [ ] Integrações/API Business.

## Regras de execução do roadmap

Antes de qualquer item:

1. ler `docs/PRODUCT_CONSTITUTION.md`;
2. ler `docs/DEVELOPMENT_HANDOFF.md`;
3. confirmar estado real do código e testes;
4. identificar dependências e fundações reutilizáveis;
5. decompor grandes itens em incrementos auditáveis;
6. preservar segurança, privacidade e modo manual;
7. criar testes antes de declarar concluído;
8. disponibilizar Preview quando aplicável;
9. notificar o proprietário com roteiro de teste humano;
10. não fazer merge sem autorização explícita;
11. atualizar estes documentos quando mudar estratégia, arquitetura, prioridade ou próximo gate — sem exigir que o proprietário lembre de pedir.

## Filtro para novas ideias

Uma nova ideia sobe no roadmap quando responde positivamente, de forma defensável, à maior parte destas perguntas:

- fortalece o núcleo do Kyrub ou o comércio/relações locais?
- resolve problema real?
- cria valor claro para usuário/empresa/ecossistema?
- existe modelo de sustentabilidade/monetização quando necessário?
- reutiliza dados ou infraestrutura já existentes?
- fecha um ciclo de valor em vez de ser apenas mais uma tela?
- pode respeitar privacidade, consentimento e segurança?

**Prioridade padrão: fundação reutilizável > ciclo completo de valor > feature isolada.**
