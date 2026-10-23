# Kyrub — Contrato de métricas do ecossistema (proposta)

## Limites de acesso

- **Administração Kyrub**: fonte autoritativa e autorização por papel para métricas globais.
- **Loja oficial**: pode exibir uma visão administrativa do ecossistema **somente** para usuários que também possuam permissão administrativa específica. Ser proprietário ou staff da loja oficial não concede acesso.
- **Outras lojas**: apenas CRM comercial restrito ao próprio `storeId`. Não consultar nem entregar métricas globais em APIs do CRM.
- Os clientes do CRM comercial surgem de relacionamento real com a loja; cadastro na plataforma, isoladamente, não constitui relação comercial.
- Aplicar autorização no servidor e regras Firestore, não apenas na interface.

## Fontes verificadas na homologação

| Indicador | Fonte | Critério inicial | Limitação |
|---|---|---|---|
| Cairubidos | `users` | documentos de usuário | deduplicar por UID; estado de conta não equivale a atividade |
| Lojas | `stores` | lojas canônicas | não somar `tenants` legados como lojas adicionais |
| Lojistas com plano pago | `kyrub_admin/control_plane/store_entitlements` + `store_subscriptions` | `source=subscription`, `status=active`, plano Pro/Business; conciliar estado de cobrança | não confundir cortesias/promoções com assinaturas pagas |
| Entregadores | evidências operacionais com `courierId` | UID distinto com entrega concluída no período | reivindicação/visualização de oportunidade não equivale a entrega concluída; verificar fonte e estados canônicos antes de implementar agregação |
| Freelancers | `freelanceJobs` em `LegacyApp.tsx` usa `localStorage` | **não publicar contagem global** | falta fonte persistente autoritativa identificada |

## Definições propostas (não implementadas)

- **Ativação de loja**: UID com loja canônica criada, distinto do total de usuários.
- **Conversão paga**: UIDs com direito pago ativo / UIDs com loja canônica; publicar numerador e denominador.
- **Entregador ativo em 30 dias**: UID distinto com pelo menos uma entrega concluída nos últimos 30 dias; 60/90 dias como janelas independentes.
- **Freelancer ativo**: não calcular até haver trabalho concluído persistido no servidor e vínculo inequívoco ao UID.
- **Retenção**: atividade comprovada em coortes e períodos comparáveis; não inferir de abertura de tela.
- **Segmentos sobrepostos**: uma pessoa pode ser lojista, entregador e freelancer. Não somar segmentos para obter pessoas únicas.
- **Dados indisponíveis**: mostrar “Indisponível”, nunca zero fictício.

## Implementação incremental proposta

1. Criar endpoint administrativo de agregados com permissão específica e auditoria; reutilizar contagens já existentes do `adminControlPlane`, sem clonar a lógica de autorização.
2. Adicionar contagem de assinantes pagos por entitlement validado e reconciliado; testar promoções, cancelamentos, duplicidades e tenants legados.
3. Confirmar ledger de entregas concluídas e suas permissões; agregar somente evidências canônicas.
4. Projetar fonte persistente de trabalho freelance antes de oferecer métricas globais desse segmento.
5. Expor os agregados no contexto da loja oficial **apenas a administradores Kyrub autorizados**; preservar o módulo CRM padrão do ERP para todas as lojas.

## Critérios de aceite

- Lojista comum e staff da loja oficial recebem acesso negado aos agregados globais no backend.
- Nenhuma resposta do CRM de loja contém contagens globais nem dados de clientes de outra loja.
- Contagens são reproduzíveis e identificam janela temporal, fonte e status de disponibilidade.
- Um mesmo UID em múltiplos segmentos não duplica a base de Cairubidos.
- Não há mudança no checkout, cobrança, produção ou homologação até aprovação de implementação.
