# Piloto de otimização JPEG do mural (issue #1278)
Escopo: somente upload comunitário JPEG, sem dependência, serviço pago ou alterações de regras. Base 4134b44e0351555dd9e3583adf6f279202ee842b.
- Acima de 350 KiB e dentro do limite atual de 8 MiB, inspecionar SOF antes do decode (até 24 MP); bitmap orientado por EXIF, lado máximo 1800 px, JPEG qualidade 0,84. Aceitar somente redução >=10%; fallback original em erro, codec indisponível ou cabeçalho desconhecido. Sem ampliação. Revalida UID antes do envio.
- PNG/WebP permanecem originais nesta etapa para preservar transparência e animações; vídeo e capas inalterados. Não deduplicar entre posts, alterar exclusões ou limpar órfãos sem reconciliação própria.
- Contratos em testes existentes (prebuild). Mocks não comprovam codec real nem qualidade visual. Homologação adicional: Chromium e Android real com JPEG grande, orientação EXIF 6/8, fotografia pequena, PNG transparente, WebP animado e vídeo; registrar bytes de entrada e saída e dimensões, publicar/encaminhar e conferir mídia. Usar ambiente isolado, não produção.
- Nenhuma alegação de economia real antes de medir. Nenhum merge/deploy autorizado.
