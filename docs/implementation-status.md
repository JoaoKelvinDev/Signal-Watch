# Estado da implementação — 29/10/2026

## Revisão atual: segurança antes do commit

Revisão completa do inventário versionável com foco em backend/API, credenciais, scripts e implantação. Relatório: [security-review-2026-10-29.md](security-review-2026-10-29.md).

Corrigidos envio nativo de senha por GET, disputas de estado entre administração/worker, multiplicação de pools por requisição, falta de limite no readiness, corpo administrativo sem prazo, exclusão de `.vercel` no Docker, REVOKE amplo no bootstrap, cabeçalhos HTTP ausentes, origem/cookie atrás de proxy e janelas de quota inválidas.

Validação atual: **93 testes de unidade + 34 de banco, 127 aprovados**; lint, tipos, build, migrações e HTTP aprovados. Auditoria npm sem vulnerabilidades conhecidas. Scanner cobre arquivos versionáveis, bundle e 139 blobs do histórico, sem achados nos padrões examinados. Supabase conferido somente em leitura; RLS e grants continuam restritos.

Pendente: testar novamente o contexto/imagem Docker (daemon desligado), validação de produção/GUI, backup e limites operacionais descritos no relatório. Não houve commit, push, deploy ou alteração remota nesta revisão. Aguardar autorização do proprietário após a análise dos resultados.

## Histórico: Supabase e fluxos do MVP

Escopo autorizado: migrar para o Supabase exclusivo Signal-Watch, adaptar para Vercel Hobby e concluir os recursos pendentes do MVP. Banco remoto migrado. O proprietário confirmou o cadastro de `DATABASE_URL`, `ADMIN_PASSWORD` e `CRON_SECRET` em Production na Vercel; os valores não foram compartilhados. A conexão e os fluxos remotos serão verificados após publicar a revisão. Não declarar o produto 100% funcional em produção.

Implementado nesta revisão:

- Supabase com as três migrações Drizzle e ledger preservado. Oito tabelas com RLS e sem grants para `anon`/`authenticated`; conexão somente pelo backend, TLS verificado e pool reduzido para serverless.
- Cópia preservando IDs e timestamps: duas fontes, 126 itens/eventos/evidências e 13 execuções. Identidades das oito tabelas comparadas com a exportação, sem divergência; zero vínculos órfãos. Banco local preservado.
- Endpoint POST de coleta autenticado com segredo, bloqueio de previews, orçamento de execução e fila/leases existentes. Worker local reutiliza a mesma orquestração. Script Supabase Cron/pg_net/Vault preparado, sem agendamento remoto ativo.
- Filtros completos, classificação de temas por metadados, idioma desconhecido preservado, período por publicação e ordenação por relevância documentada. Cursor vincula todos os filtros.
- Página de evento com evidências, cobertura vinculada e histórico, sem expor JSON bruto ou inventar resumo.
- Favoritos, lidos, preferências e tema persistidos no navegador; sem cadastro/sincronização.
- Administração com senha de servidor, sessão assinada, cookies protegidos e CSRF. Cadastro GitHub não verificado, ativação após revisão documental e teste real, configuração de intervalos, pausa, saúde/quotas e reprocessamento paginado/idempotente.
- `.gitignore` inclui metadados locais da Vercel; arquivos privados de teste e exportações permanecem ignorados. Nenhuma dependência nova, commit, push ou redeploy nesta revisão.

Validação desta revisão:

| Verificação                           | Resultado                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Testes offline                        | 82 aprovados                                                                                                                               |
| PostgreSQL local descartável          | 31 aprovados; filtros, RLS, detalhe, ranking, cadastro/admin e idempotência, além das regressões anteriores                                |
| Contratos online                      | GitHub Releases e Hacker News aprovados com respostas reais                                                                                |
| Coleta pelo novo endpoint autenticado | Duas fontes, 27 itens novos, uma duplicata, nenhuma falha; execução independente da interface                                              |
| HTTP no build de produção local       | Login, CSRF, pausa/retomada, reprocessamento, evento, preferências/admin, logout, cron sem Bearer e `.env` protegido                       |
| Feed HTTP após coleta                 | Três releases oficiais, 150 itens comunitários, 30 páginas sem repetir eventos, pesquisa/filtros e 150 links validados                     |
| Auditoria npm                         | Zero vulnerabilidades conhecidas na consulta executada                                                                                     |
| Migração Supabase                     | Três migrações registradas, oito tabelas com RLS, zero grants públicos examinados e identidades correspondentes                            |
| Advisor Supabase de segurança         | Sem warnings/erros; oito informações de RLS sem política intencionais para acesso exclusivo pelo servidor                                  |
| Segredos e Gitignore                  | Nenhum achado nos padrões/valores examinados nos arquivos versionáveis e bundle; `.env`, exportação, segredos locais e `.vercel` ignorados |

Durante a validação, corrigida a verificação CSRF para origem pública atrás do proxy Next/Vercel e cookie Secure em produção. Também foi impedido que pausar/retomar uma fonte contornasse o estado de bloqueio; reprocessamento ganhou continuação por cursor. O teste HTTP anterior tinha expectativa de um texto antigo da interface; substituída por verificações de idioma e região principal acessível.

Evidências: [relatório final](evidence/cloud-validation.json), [migração Supabase](evidence/supabase-migration.json), [HTTP MVP](evidence/mvp-http.json), [ciclo autenticado](evidence/scheduled-http.json), [checagem de segredos](evidence/cloud-secrets-check.json). Lint, tipos, build e formatação aprovados ao finalizar. Revisões anteriores abaixo são históricas, não o estado atual.

Bloqueado/pendente para aceite em produção:

1. Cadastro de `DATABASE_URL`, `ADMIN_PASSWORD` e `CRON_SECRET` em Production confirmado pelo proprietário. Validar os valores indiretamente pelo funcionamento da aplicação após o deploy, sem revelar credenciais. Origem pública automática ou `APP_ORIGIN` conforme domínio utilizado.
2. Após revisão/aprovação dos resultados, enviar código e publicar no projeto Vercel existente; nenhum push/redeploy foi feito pelo agente.
3. Configurar Vault, ativar o agendamento preparado e verificar ciclos reais na Vercel, inclusive com navegador fechado e reinício. O teste local do endpoint não comprova agendamento remoto.
4. Verificar backup/restauração e consumo real dos planos. Custos não garantidos como gratuitos.
5. Revisão visual, teclado e interações reais do navegador não executadas: nenhum navegador CUA conectado nesta sessão. HTTP e testes de armazenamento não substituem essa verificação.

Integrações operacionais verificadas: GitHub Releases e HN. RSS de blogs, Reddit, arXiv, provedores licenciados e LLM continuam desativados/não implementados; não são simulados. HN é sinal comunitário, e termos/direitos de exibição e retenção devem continuar sendo revisados pelo operador. A deduplicação é conservadora por URL/versão; não há agrupamento semântico de URLs distintas. Títulos sem tradução determinística permanecem originais, identificados como metadados.

Próximo passo: obter a confirmação do proprietário para enviar a revisão validada à `main` de `JoaoKelvinDev/Signal-Watch`, o que pode acionar o deploy automático, e então seguir a validação remota de [deployment-supabase-vercel.md](deployment-supabase-vercel.md).

## Histórico: reorganização validada após aprovação

O proprietário aprovou a execução de testes e as correções após a reorganização. A estrutura `app/frontend/api/backend/shared` foi validada sem criar novos serviços, dependências, endpoints ou migrações. O site local permanece em **http://127.0.0.1:3000**.

- Código movido para `src/frontend`, `src/api`, `src/backend` e `src/shared/contracts`. `src/app` mantém somente as entradas Next.js; as rotas HTTP delegam aos handlers.
- Scripts agrupados por responsabilidade. Referências de scripts npm, inicializador local, Drizzle, estilos e testes ajustadas aos novos caminhos.
- Limites de dependência entre camadas registrados no ESLint e em [architecture.md](architecture.md).
- `.gitignore` organizado para excluir dependências, saídas de build, caches, `.env`, segredos, banco local, backups, logs e configurações pessoais. Lockfile, testes e migrações continuam versionáveis. Contexto Docker também revisado.
- Nenhuma dependência, regra editorial, consulta SQL, migração ou endpoint novo. Nenhum repositório Git inicializado e nenhum envio ao GitHub.
- Conferência desta revisão limitada à análise estática: 46 arquivos de código analisados, 84 imports relativos e 13 referências de entrada/estilos resolvidos, sem achados estruturais nessa análise. Os corpos dos dois handlers GET foram comparados com a versão anterior e permanecem iguais. Isso não verifica tipos nem comportamento em execução. Foram movidos 31 arquivos e ajustadas 56 referências de importação. Evidência: [evidence/architecture-review.json](evidence/architecture-review.json).
- A conferência estática citada acima é o registro anterior à aprovação. A validação executável foi concluída nesta revisão, conforme a tabela abaixo.

| Verificação da revisão atual                        | Resultado                                                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Lint e limites de camadas                           | Aprovados                                                                                            |
| Tipos TypeScript e build Next.js                    | Aprovados                                                                                            |
| Formatação                                          | Aprovada ao finalizar                                                                                |
| Testes Windows/PostgreSQL local                     | 67 offline + 23 de banco: **90 aprovados**                                                           |
| Testes Docker Linux/PostgreSQL isolado              | Mesmos **90 aprovados**, usuário UID 1000                                                            |
| Migrações                                           | Aplicadas no teste; Drizzle sem divergência de schema ou nova migração                               |
| Contratos públicos reais                            | GitHub Releases e HN aprovados, sem token obrigatório                                                |
| Coleta reproduzível em Docker                       | 1 release e 25 submissões HN persistidas                                                             |
| Feed HTTP                                           | Pesquisa, tema/fonte, paginação e links aprovados no ambiente local e no Docker                      |
| Superfície HTTP                                     | Leitura/prontidão 200; POST no feed 405; acesso ao `.env` 404                                        |
| Persistência Docker                                 | 25 IDs comunitários preservados ao recriar contêiner do banco; anúncio oficial permaneceu disponível |
| Auditoria npm online                                | **0 vulnerabilidades conhecidas** na consulta executada                                              |
| `.gitignore` com Git real em repositório temporário | 18 caminhos privados ignorados; 15 caminhos necessários preservados                                  |
| Segredos e bundle                                   | Sem achados nos padrões examinados; sem referência de banco/tokens no bundle estático                |
| Imagem Docker                                       | Sem `.env` ou `.local`; arquivos editáveis pelo usuário `node`, sem root                             |

Problemas encontrados e corrigidos:

- A espera por DNS ficava fora do timeout/cancelamento. Agora DNS, conexão e corpo compartilham 15 segundos; sinal já cancelado não inicia DNS, e resolução tardia não abre socket. Testes reproduziram as falhas antes da correção e passaram depois. O resolvedor do sistema pode concluir a consulta em segundo plano.
- O bloco especial 192.88.99.0/24 não era bloqueado. Foi incluído após consulta ao [registro IANA](https://www.iana.org/assignments/iana-ipv4-special-registry), com regressão para o endereço não global 192.88.99.2. Corpos de erro/redirect são fechados e seus erros de stream são tratados.
- Arquivos da imagem pertenciam a root, impedindo o Vitest de escrever temporários como usuário `node`. Dockerfile ajustado para instalação, cópia, build e execução sem root; testes Linux passaram após a correção.

Evidências: [relatório da validação](evidence/validation-after-refactor.json), [Gitignore](evidence/gitignore-review.json), [HTTP local](evidence/feed-http.json), [HTTP Docker](evidence/docker-feed-http.json). Contêineres do projeto isolado `radar-validation` encerrados ao final, sem apagar seu volume; banco local e site original preservados. Nenhuma conta, contratação, publicação, commit ou push ao GitHub.

Limites da validação: não havia navegador CUA conectado; cliques, teclado e capturas visuais não foram executados. Revisão de código, testes e auditoria npm não equivalem a garantia de ausência de todas as vulnerabilidades nem a auditoria de pacotes do sistema operacional da imagem. Administração protegida e demais itens pendentes do MVP continuam fora desta entrega. Custos de hospedagem/planos externos não verificados; Reddit/LLM permanecem desativados. Não iniciar novas funcionalidades sem uma próxima instrução do proprietário.

## Histórico: feed aprovado e acessível localmente

O usuário aprovou continuar após a primeira entrega. Acesso: **http://127.0.0.1:3000**, neste computador, com banco e worker ativos. `.env` local foi configurado sem tokens e permanece ignorado no Git. `npm.cmd run local` aplica migrações/projeção e inicia ou reutiliza o site, mantendo seu worker. A sessão de validação na porta 3001 foi encerrada; o acesso da porta 3000 permanece disponível.

Implementado nesta etapa: projeção editorial transacional, deduplicação conservadora por URL/versão, histórico factual, backfill dos 26 itens, API própria com paginação por cursor/FTS/filtros de tema e fonte, abas oficiais/comunidade, procedência, datas de Brasília, status das fontes, estados de vazio/erro/carregamento e tema claro/escuro. Dados comunitários não são promovidos por popularidade. Resumos não são inventados; os títulos comunitários permanecem originais. Identificação de IA e empresas em HN é regra por título, com alcance limitado e possibilidade de erros.

Validação desta etapa:

- **62 testes offline + 23 no PostgreSQL real aprovados (85 no total)**. Novos casos cobrem deduplicação/retag, histórico sem mudanças de formatação, publicação nula, proveniência, busca parametrizada, filtros, cursor empatado com microssegundos, removidos e primária inválida/não verificada.
- Lint, tipos e build aprovados. Formatação verificada ao final.
- Migração `0001_sharp_tarot.sql` aplicada ao banco local e aos testes; 26 itens existentes projetados sem simulação.
- HTTP real final: 1 anúncio oficial; pesquisa Transformers encontra o evento; filtro de fonte funciona; 50 registros de comunidade percorridos em 10 páginas sem IDs repetidos; links e discussão validados; parâmetros inválidos 400; página/readiness 200. O worker acrescentou 25 submissões reais durante a validação, totalizando 51 itens persistidos. Evidência: [evidence/feed-http.json](evidence/feed-http.json).
- Comando local validado em porta 3001, incluindo migração, projeção e site+worker; página e feed 200; Ctrl+C encerrou a instância de teste. Banco e acesso 3000 preservados.
- Nenhuma referência a DATABASE_URL, GITHUB_TOKEN, URL PostgreSQL ou radar_dev no bundle estático examinado.
- **QA visual e cliques não executados:** a ferramenta CUA informou zero navegadores disponíveis. Responsividade/acessibilidade receberam revisão estática; HTTP não substitui teste interativo de navegador.

Limites atuais: ainda não há painel administrativo, favoritos/lidos persistentes, preferências salvas, tela completa de evento/histórico, filtros por empresa/idioma/período/status, ranking de relevância ou feeds RSS. Docker Compose, restauração de backup, retenção e métricas operacionais permanecem sem validação. O GitHub segue com janela parcial de duas páginas; o HN também sinalizou pendências além dos 25 detalhes permitidos por ciclo. Reddit/LLM/provedor licenciado continuam desativados; não há chave obrigatória para GitHub/HN públicos. Custos de hospedagem, tráfego e armazenamento continuam não verificados; nenhum serviço contratado ou publicação realizada. O site local não representa implantação de produção.

Próximo passo somente após nova autorização: ampliar a leitura editorial e a administração protegida, dentro das prioridades do AGENTS.md. Abaixo está o registro histórico da primeira entrega, preservado para rastreabilidade.

## Histórico: primeira etapa entregue

Primeira etapa verificável: infraestrutura local de ingestão. O AGENTS.md foi lido integralmente no disco antes da implementação. O repositório continha somente esse arquivo. A aplicação **não está declarada como MVP concluído**. Não houve publicação, criação de conta ou contratação.

Implementado:

- Next.js/React/TypeScript com página provisória explícita e readiness sem vazamento de erros.
- Drizzle/PostgreSQL, migração versionada para as oito tabelas obrigatórias de dados/operação, índices e unicidade. Administração ainda não existe; portanto não foram criadas tabelas de usuários/sessões antecipadamente.
- Catálogo idempotente, fontes inicialmente não verificadas, ativação via teste online separado.
- GitHub Releases do Hugging Face Transformers e API oficial HN: configuração e respostas validadas por Zod, metadados limitados e procedência mantida. Datas ausentes e idiomas desconhecidos permanecem nulos.
- Transporte restrito a dois hosts/caminhos em HTTPS, IPv4 público resolvido e fixado, sem redirecionamento, limite de resposta e prazo. URLs externas de artigos não são consultadas.
- Scheduler independente do navegador, fila PostgreSQL, exclusão de jobs simultâneos por fonte, reserva com SKIP LOCKED, lease recuperável e token contra commit obsoleto.
- Escrita transacional de itens/cursor, retry com backoff/jitter, Retry-After/reset e isolamento de falha por fonte. 401/403 sem quota bloqueiam a fonte. Cinco tentativas por job.
- Logs sanitizados, último sucesso distinto de última tentativa, contagens e quota; janela truncada registrada.
- Dockerfile/Compose, `.env.example`, lockfile, README e decisões de arquitetura.

## Testado

Validação final concluída: 46 testes aprovados (37 offline + 9 no PostgreSQL), lint, tipos, formatação e build aprovados. Worker, servidor Next.js e PostgreSQL temporários foram encerrados após as verificações; os dados permanecem em `.local/postgres`.

| Verificação                                        | Resultado observado                                                                                      |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Testes offline de adapters, transporte e readiness | 37 testes aprovados                                                                                      |
| Testes em PostgreSQL 18 real e descartável         | 9 testes aprovados                                                                                       |
| Migrações                                          | Aplicadas duas vezes nos testes, sem duplicação; geração posterior não detectou divergência              |
| Lint e tipos                                       | Aprovados na execução final                                                                              |
| Build Next.js                                      | Aprovado na execução final                                                                               |
| Formatação                                         | `prettier --check .` aprovado                                                                            |
| Contratos online                                   | GitHub Releases e HN aprovados sem credenciais                                                           |
| Ciclo real                                         | 1 release e 25 histórias gravadas, em execuções bem-sucedidas separadas por fonte                        |
| Worker contínuo                                    | Fonte GitHub tornada devida no banco; worker detectou e coletou sem navegador; 0 inserções e 1 duplicata |
| Persistência após reinício do PostgreSQL           | 26 itens antes e 26 depois, no banco isolado `radar_dev`                                                 |
| HTTP local                                         | Página inicial 200; `/api/health/ready` 200 com `status=ready`                                           |
| Auditoria npm online                               | 0 vulnerabilidades após override transitivo; sem `audit fix --force`                                     |

A suíte de banco cobre concorrência de scheduler/worker, rollback sem avanço de cursor, replay idempotente, datas nulas/descoberta original, recuperação de lease e bloqueio do worker antigo, falha de uma fonte sem bloquear outra, espera de quota, limite de tentativas e 304. A suíte offline cobre schemas, drafts, prerelease, paginação limitada, IDs HN divergentes, conteúdo removido/ausente, URLs perigosas, DNS privado antes do socket, fixação de IP, redirecionamento, limite de 2 MiB, timeout de 15 segundos e sanitização de erros. Mocks existem apenas nos testes offline.

Evidências reais sanitizadas: [evidence/ingestion.json](evidence/ingestion.json). Os horários dessa evidência são UTC. A execução local ocorreu entre 12h28 e 12h35 de 28/10/2026, em America/Sao_Paulo. Logs do banco e dados de teste ficam apenas em `.local/`, ignorado no Git.

## Limitações e bloqueios

- GitHub atingiu duas páginas: `WINDOW_TRUNCATED`. A coleta não promete todos os releases dos últimos sete dias. HN cobre somente janela recente e backfill inicial de 25 itens. Ainda não há reconciliação periódica de remoções/edições fora dessas janelas.
- Idempotência por fonte/ID está implementada. Agrupamento editorial entre fontes e histórico de alterações factuais de eventos ainda não estão implementados. As tabelas editoriais permanecem vazias; metadados coletados não são promovidos a eventos.
- Feed, cursor público, pesquisa, filtros, classificação, tela de evento, comunidade, fontes, favoritos, preferências, temas claro/escuro e administração protegida ainda não implementados. Não há E2E do feed nem QA visual do produto.
- Enriquecimento LLM não implementado e não requisita chave. Reddit permanece desativado, sujeito à aprovação da plataforma e credenciais. Feeds de blogs oficiais ainda não verificados/implementados; arXiv/provedor de notícias opcionais não implementados.
- Docker Compose não executado: daemon desligado. Os testes de banco usaram cluster novo dentro do workspace, sem usar os dados ou alterar o serviço PostgreSQL preexistente. O cluster de testes usa trust em loopback e não serve como configuração de produção.
- Retenção/expurgo automatizados, restauração de backup, métricas p95, administração e configuração ampliada dos limites operacionais ficam pendentes. Nenhuma garantia operacional de 15 minutos foi comprovada.
- Hospedagem, tráfego, armazenamento e planos comerciais não tiveram custos verificados. Nenhum custo de LLM nesta etapa, pois não há chamadas de inferência. Não foi contratado serviço.
- No ambiente restrito do Codex/Windows, Drizzle/tsx e inicialização de PostgreSQL precisaram de execução ampliada por falha `uv_os_get_passwd`/token restrito. Não foi alterada a política do PowerShell.

## Próximo passo registrado na primeira entrega (realizado na etapa atual)

Normalização editorial e deduplicação entre coberturas, com testes de separação de versões; depois endpoints de feed por cursor e pesquisa PostgreSQL. Implementar o consumidor de `source_items.processing_state=pending` antes da interface do feed. Parar ao encerrar esta etapa e aguardar a autorização solicitada pelo usuário.
