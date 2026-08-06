# Persistência de imagens do Kyrub

Esta etapa conecta os seletores de imagem já existentes ao Firebase Storage, preservando as opções de Google Fotos, Google Drive e URL externa.

## Concluído

- upload direto do dispositivo em todos os controles que usam o seletor compartilhado de imagens;
- logo e banner da loja;
- imagem principal de produtos e serviços;
- imagens de subcategorias do catálogo;
- demais imagens de ofertas que reutilizam esses controles;
- validação de JPEG, PNG e WebP;
- limite de 10 MB por imagem;
- armazenamento separado por usuário autenticado;
- endereço persistente compatível com vitrines públicas;
- deduplicação pelo hash SHA-256 do conteúdo;
- regras que impedem outro usuário de substituir ou excluir o arquivo;
- testes de autorização no emulador;
- publicação das regras no projeto Firebase `kyrub-b8d0e`.

## Fluxos que já eram persistentes

- avatar do perfil;
- imagens das publicações sociais;
- capa das comunidades;
- documentos e selfies de verificação.

## Fora desta etapa

Chat e notas ainda não possuem controles de imagem nos seus fluxos atuais. Portanto, nenhum anexo novo foi criado artificialmente nessas telas. Quando o produto definir como esses anexos devem aparecer, ser compartilhados e removidos, eles poderão usar a mesma camada de Storage.

As imagens antigas externas ou locais não são migradas silenciosamente, pois não há como confirmar com segurança o proprietário original. Novas escolhas feitas pelo botão **Dispositivo** passam a usar o Storage.

## Fluxo de entrega

- branch `feat/app-media-storage` empilhada sobre `feat/cloud-communities-debates`;
- PR em rascunho;
- validação de build, TypeScript, regras e Vercel antes do preview;
- nenhum merge sem autorização explícita.
