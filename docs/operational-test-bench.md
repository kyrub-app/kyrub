# Bancada de testes operacionais

A bancada valida os fluxos críticos do Kyrub sem depender de deploy da Vercel, credenciais da 99Food ou dados de produção.

## Executar

```bash
npm run test:operational
```

O comando cobre:

- pedido presencial por QR Code oculto do KDS antes da revisão;
- aprovação do staff mantendo o pedido `pending` para decisão do KDS;
- ciclo `pending → accepted → preparing → ready → out_for_delivery → completed`;
- bloqueio de saltos inválidos de estado;
- filtro de origem para ambientes, Kyrub Ofertas, PDV/Staff e 99Food;
- carga repetida de eventos 99Food sem multiplicar a identidade lógica;
- fila por `availableAt`, retentativa e descarte do payload sensível após sucesso;
- reivindicação atômica de entregas e fallback depois de três minutos;
- motivo obrigatório e alternativa em recusas.

## Critério durante o bloqueio de builds

Enquanto a cota da Vercel estiver indisponível, uma PR operacional pode avançar quando:

1. `npm run test:operational` passa;
2. `npm run prebuild` passa no GitHub Actions;
3. os testes de regras passam quando houver mudança no Firestore;
4. não há segredo ou credencial versionada;
5. a ausência do preview da Vercel está registrada na PR.

A bancada não substitui o teste visual final em navegador. Ela reduz o risco antes desse teste e torna regressões de fluxo detectáveis no CI.
