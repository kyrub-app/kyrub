# Roadmap Estratégico do Kyrub

> Documento-mãe de direção e checklist. **Não confundir item planejado com funcionalidade já implementada.** O estado executável atual deve ser confirmado no código, testes, PRs e `docs/DEVELOPMENT_HANDOFF.md`.

## Convenções

- `[ ]` planejado / pendente;
- `[~]` em andamento;
- `[x]` entregue e validado;
- `[!]` bloqueado / exige decisão;
- preços, franquias e comissões marcados como V1 são hipóteses sujeitas a validação econômica/jurídica antes de cobrança real.

## Horizonte A — AGORA

- [~] Concluir PR #152: ativação de Loja Kyrub e criação segura de produtos pela Kyrubia.
- [ ] Implementar criação sequencial real de múltiplos produtos: Produto 1 → confirmação → gravação → Produto 2 → confirmação → gravação.
- [ ] Impedir que entradas como “Teste 2 e Teste 3” sejam interpretadas como um único produto quando o objetivo declarado é cadastrar vários itens.
- [ ] Revalidar capacidade antes de cada criação; servidor continua autoridade final.
- [ ] Alterar handoff comercial do limite Free de Business para **Pro**.
- [ ] Preservar cache consistente do contexto ERP após criação de produto.
- [ ] Preservar modo manual, idempotência, recibos, Policy Engine e autorização server-side.
- [ ] Executar novo teste humano no Preview estável antes de merge.
- [ ] Não fazer merge de #152 sem autorização explícita.

## Horizonte B — Fundações transversais

- [ ] Centralizar planos, permissões e limites em uma camada de entitlements.
- [ ] Modelar Free → Pro → Business sem condicionais comerciais espalhadas.
- [ ] Estruturar eventos reutilizáveis de busca, visualização, clique, compra, reserva, campanha, ação da Kyrubia e retorno de cliente.
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
- [ ] Criar futuramente indicador de Valor Gerado pelo Kyrub.

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

- [ ] Criar comunidades oficiais pelo perfil Kyrub.
- [ ] Kyrubia atua como anfitriã/educadora e, futuramente, moderadora.
- [ ] Avaliar “Comece pelo Kyrub”, “Kyrubia na prática”, “Venda mais com sua Loja Kyrub”, “Kyrub Freela” e “Comunidade Kyrub”.
- [ ] Usar comunidades para onboarding contínuo.
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
10. não fazer merge sem autorização explícita.

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