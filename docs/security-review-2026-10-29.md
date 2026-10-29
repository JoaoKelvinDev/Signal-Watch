# Revisão de segurança antes do commit — 29/10/2026

Revisão solicitada pelo proprietário antes de enviar a versão ao GitHub/Vercel. Não houve commit, push, deploy, ativação de cron ou alteração de schema remoto durante esta revisão.

## Escopo e método

Inventário dos arquivos versionáveis atuais, incluindo código, configurações ocultas, scripts, migrações, snapshots, testes, documentação e lockfile. Leitura manual dos caminhos executáveis e controles de segurança, com prioridade em backend/API; varredura automatizada dos demais arquivos e do bundle estático. Histórico Git examinado em todos os 139 blobs alcançáveis pelas referências locais, sem imprimir valores encontrados. Não equivale a leitura manual de cada dependência em `node_modules`, auditoria binária do PostgreSQL ou análise dos pacotes do sistema operacional.

O [inventário](evidence/security-file-inventory.json) registra tamanho e hash dos arquivos versionáveis, exceto os próprios relatórios mutáveis do scanner. O [relatório de segredos](evidence/cloud-secrets-check.json) contém a contagem final e os resultados. Arquivos privados e gerados em `.local`, `.env`, `.vercel`, `.git`, caches e dependências não serão enviados; os padrões de exclusão foram conferidos. Os valores privados cadastrados somente no painel Vercel não foram lidos nem solicitados.

## Achados corrigidos

| Identificação                 | Risco identificado                                                                                                                                              | Correção e verificação                                                                                                                                                                                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R01 — médio                   | Formulário administrativo sem método explícito podia enviar senha na URL se submetido antes da hidratação JavaScript.                                           | Login nativo usa POST para `/api/admin`. Teste HTTP examina o HTML servido; a API recusa formulário nativo sem JSON/origem apropriada. Senha não deve ir em query string.                                                                                                          |
| R02 — médio                   | Estado lido antes de uma atualização concorrente podia reativar fonte bloqueada; retry do worker podia desfazer pausa administrativa.                           | Ativação condicionada atomicamente ao estado/verificação no UPDATE; pausa usa estado atual do banco; falhas transitórias preservam o estado existente. Teste com duas transações reais reproduz a disputa e confirma que bloqueio prevalece.                                       |
| R03 — médio                   | Pool novo por requisição multiplicava conexões, apesar do limite por pool. Readiness público também acessava o banco sem limite de consultas.                   | APIs reutilizam pool por runtime, com máximo de um cliente na configuração cloud. Readiness limitado a 60 consultas/minuto/processo e sem cache. Testes cobrem reuso de 100 acessos, falha de inicialização e rajadas de prontidão. Não representa limite global entre instâncias. |
| R04 — médio                   | Corpo administrativo tinha limite de bytes, mas um cliente que não encerrasse o stream podia ocupar a função.                                                   | Prazo total de cinco segundos com cancelamento, mantendo 4 KiB. Testes incluem JSON completo sem fechamento, transporte com cancelamento pendente e requisição já abortada.                                                                                                        |
| R05 — médio, preventivo       | `.vercel` não estava no `.dockerignore`; arquivos privados colocados nessa pasta poderiam entrar em uma imagem futura. Nenhum vazamento efetivo foi encontrado. | Exclusão explícita de `.vercel`, credenciais usuais de ferramentas e backups no contexto Docker/Git. O teste real de contexto Docker ficou bloqueado porque o daemon está desligado.                                                                                               |
| R06 — médio, operacional      | Bootstrap revogava grants de todas as tabelas públicas, podendo atingir objetos alheios se fosse usado em destino inadequado.                                   | REVOKE limitado às oito tabelas do Radar; bootstrap também recusa ledger Drizzle preexistente. SQL gerado para revisão; não reaplicado ao banco remoto populado.                                                                                                                   |
| R07 — baixo, defesa adicional | Ausência de cabeçalhos explícitos contra enquadramento, sniffing de MIME e vazamento de referrer.                                                               | X-Frame-Options DENY, CSP com frame-ancestors/base-uri/object-src/form-action, nosniff, no-referrer e Permissions-Policy. Cabeçalhos conferidos por HTTP. A CSP não é uma política completa de bloqueio de scripts; nenhum uso de HTML bruto foi identificado.                     |
| R08 — baixo                   | Configuração de origem opaca podia aceitar Origin null; cookie fora da Vercel não considerava HTTPS público de um proxy.                                        | Origem HTTP(S) válida, sem credenciais; origens opacas recusadas. Cookie Secure também considera a origem pública configurada. Testes de regressão aprovados.                                                                                                                      |
| R09 — baixo, disponibilidade  | Cabeçalhos externos de quota malformados ou enormes podiam gerar NaN/Infinity/Invalid Date na fila.                                                             | Janela inválida ou superior a sete dias bloqueia a integração para diagnóstico, sem encurtar Retry-After nem iniciar loop agressivo. Testes cobrem texto inválido, número excessivo e reset inválido.                                                                              |

## Controles conferidos

- Consultas e filtros usam parâmetros Drizzle; `sql.raw` aparece somente na exportação com nomes de tabelas constantes, nunca com entrada HTTP. Teste de SQL injection preserva o acervo no banco descartável.
- Autenticação e autorização administrativas no servidor; HMAC com expiração/nonce e comparação em tempo constante, cookie HttpOnly/SameSite Strict/Secure, CSRF por origem pública e JSON.
- Cron somente por POST com Bearer forte, comparação em tempo constante e bloqueio de previews. Coleta não depende de navegador.
- Transporte de coleta restrito a hosts/caminhos conhecidos em HTTPS, DNS IPv4 público fixado no socket, sem redirecionamentos, prazo e limite de 2 MiB. URLs de notícias não são buscadas pelo servidor. Tokens GitHub não são enviados a fontes HN.
- URLs públicas verificadas em leitura, sem esquemas executáveis nem credenciais; conteúdo externo exibido como texto React, sem HTML/Markdown bruto, eval ou execução de instruções.
- Banco cloud exige TLS com validação do certificado; parâmetros da URI não podem sobrescrever essa verificação. Segredos permanecem no servidor.
- Supabase Signal-Watch consultado somente em leitura: oito tabelas com RLS, nenhuma permitindo SELECT a `anon`/`authenticated`, schema Drizzle inacessível a `anon`, nenhuma função pública SECURITY DEFINER e cron ainda desativado. Advisor de segurança trouxe apenas oito informações de RLS sem política, intencionais para esse modelo. [Explicação do aviso](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- Fila com unicidade, leases, recuperação, idempotência e transações; cursor só avança após persistência. Erros de terceiros são reduzidos a códigos, sem mensagens, tokens ou payload em logs.
- Nenhum achado nos padrões de segredos examinados no código, bundle e histórico. Auditoria npm: zero vulnerabilidades conhecidas na consulta desta revisão; versões e lockfile preservados.

## Validação

- 93 testes de unidade e 34 testes PostgreSQL: **127 aprovados**.
- Lint, tipos, build de produção e consistência das migrações aprovados.
- HTTP local: login, origem externa 403, ausência de sessão 401, pausa/retomada, reprocessamento, logout, cron sem Bearer 401, `.env` 404, cabeçalhos e formulário POST aprovados.
- Feed HTTP: pesquisa, filtros, três releases oficiais, 150 itens comunitários em 30 páginas e 150 links verificados.
- Nenhuma dependência nova ou migração de schema adicionada pela revisão.

## Limites e pendências de produção

Não foram identificadas falhas críticas ou altas no escopo examinado. Isso não é garantia de ausência de vulnerabilidades. A publicação e a configuração real da Vercel ainda precisam ser testadas; o acesso direto ao painel não está disponível nesta conversa.

- Login/feed/readiness usam limitadores por processo. Proteção distribuída contra abuso depende do firewall/limites da hospedagem. Utilizar os segredos aleatórios exclusivos já orientados.
- A conexão cadastrada usa o usuário PostgreSQL com privilégios amplos. Isso amplia o impacto de um comprometimento do servidor. Recomenda-se preparar uma credencial exclusiva com privilégios mínimos antes de ampliar usuários/dados; exige configurar credencial e políticas adequadas, sem compartilhar senha em chat ou SQL versionado. Não foi alterada a credencial escolhida pelo proprietário nesta revisão.
- Logout remove o cookie, mas uma cópia roubada da sessão permanece válida até expirar, por até 12 horas, salvo rotação de `ADMIN_PASSWORD`. Não foi adicionado sistema de revogação por sessão ao MVP.
- A CSP protege enquadramento/base/objetos/formulários; não inclui `script-src` com nonce. Não existe renderização de HTML externo no produto atual.
- Docker Desktop desligado impediu testar novamente o contexto/imagem; regras analisadas, teste marcado como bloqueado. Validações Docker anteriores não cobrem esta revisão.
- Sem navegador conectado, não houve validação visual/teclado nem teste de exploração em navegador real. Cabeçalhos foram verificados por HTTP.
- Não houve teste de intrusão contra a aplicação pública, auditoria de pacotes do sistema operacional, verificação dos valores privados da Vercel ou ensaio de backup/restauração remoto.

## Referências técnicas

- [Cabeçalhos Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/headers)
- [Streams e cancelamento Node.js](https://nodejs.org/api/webstreams.html)
- [Supabase: proteção da API](https://supabase.com/docs/guides/api/securing-your-api)
- [Documentação de implantação do projeto](deployment-supabase-vercel.md)

Próximo passo: proprietário revisar estes resultados e as pendências, antes de autorizar commit/push e implantação. Não ativar o cron enquanto o endpoint publicado e os segredos não forem validados.
