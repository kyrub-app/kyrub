# PR #1134 — homologação E2E visual isolada

## Estado e limites

Aprovação do CI em `98913a6` não equivale a homologação visual. **Este roteiro ainda não foi executado por navegador.** Usar exclusivamente ambiente isolado, Firebase Emulator (Auth + Firestore, se suportado pela configuração local), usuários fictícios e servidor de desenvolvimento. Não usar projeto Firebase de produção, contas reais, pagamentos, Pix, campanhas de Pitangas, merge ou deploy.

## Preparação

1. Verificar se a configuração de desenvolvimento conecta **todos** os clientes e o Admin SDK aos emuladores, sem fallback para Firebase real; abortar se qualquer conexão de produção for detectada.
2. Habilitar `KYRUB_FIRST_STORE_PUBLICATION_SERVER_ENABLED=true` no servidor isolado e `VITE_KYRUB_FIRST_STORE_PUBLICATION_SERVER_ENABLED=true` no navegador de teste. Confirmar endpoint `POST /api/action-execute?transport=first-store-publication` e autenticação por token emitido pelo Auth Emulator.
3. Criar usuário fictício sem loja; preparar desafio `first_store_published` elegível, publicado, com 2 XP e 0 Pitangas. Registrar estado inicial dos documentos e do ledger.
4. Usar navegador automatizado com sessão de teste; não depender de login Google real. Se o app não oferecer login pelo Auth Emulator, registrar o bloqueio e **não** simular aprovação E2E.

## Casos a executar pela interface

| Caso | Ação | Evidência obrigatória |
| --- | --- | --- |
| E2E-01 | Login do usuário fictício e criação da primeira loja | Plano Free ativado; sem publicação implícita; sem XP de publicação |
| E2E-02 | Clicar Publicar | Vitrine pública visível; `firstPublishedAt` e evento verificado; exatamente um recibo e um lançamento de +2 XP; zero Pitangas |
| E2E-03 | Repetir publicação e atualizar página | Nenhum segundo recibo ou lançamento de XP; data original preservada |
| E2E-04 | Ocultar loja | Vitrine oculta; `firstPublishedAt` e XP preservados |
| E2E-05 | Editar perfil da loja oculta | Nome/descrição sincronizados sem republicar ou mudar XP/data |
| E2E-06 | Republicar loja | Visibilidade restaurada, sem nova recompensa; data original preservada |
| E2E-07 | Desabilitar flag do navegador após publicação verificada | Publicação/ocultação pelo cliente legado bloqueadas; nenhuma alteração em `publishedAt` |
| E2E-08 | Conta fictícia diferente tenta operar loja | HTTP de autorização negado; nenhum dado da loja ou ledger alterado |
| E2E-09 | Desafio ausente/inativo **antes** da primeira publicação (novo usuário) | Loja publicada normalmente, sem XP e sem Pitangas; sem concessão retroativa |
| E2E-10 | Duas solicitações simultâneas de publicação (novo usuário) | Uma primeira publicação e um único prêmio de 2 XP |

## Critérios de saída

- Guardar capturas da interface, logs sanitizados do servidor/emuladores, requisições HTTP e snapshots antes/depois (sem tokens nem segredos).
- Cada caso deve registrar PASS/FAIL/BLOCKED, versão/commit, horário e evidência reproduzível.
- Qualquer acesso ao Firebase real, concessão duplicada de XP, alteração da data original ou publicação involuntária bloqueia a liberação.
- Revisar novamente os seis workflows no HEAD final; manter Draft até homologação e autorização explícita de merge/deploy.
