# Kyrub Admin Privileged Backend

Codebase isolada de Cloud Functions de 2ª geração para operações do Control Plane.

## Estado atual

A função `adminPrivilegedStatus` comprova que a sessão possui:

- autenticação Firebase válida recebida pelo protocolo callable;
- e-mail verificado;
- registro administrativo ativo;
- papel reconhecido;
- permissão `read_overview`;
- limite de chamadas disponível;
- auditoria autoritativa gravada pelo backend.

A resposta declara `mutationsEnabled: false`. Nenhuma conta, loja, assinatura, pagamento ou integração é alterada nesta etapa.

## Validação local

```bash
npm install --prefix functions --no-audit --no-fund
npm run check --prefix functions
```

## Deploy futuro

```bash
npm run deploy:admin-functions
```

O deploy não é automático. Antes de executá-lo, é necessário confirmar o projeto Firebase, o plano compatível com Cloud Functions, o primeiro Super Admin e as regras do Firestore já publicadas.

## Segredos

Não colocar credenciais em arquivos versionados, no bundle do navegador ou em documentos legíveis pelo cliente. APIs de BaaS, pagamentos e logística deverão usar Secret Manager quando seus módulos forem implementados.
