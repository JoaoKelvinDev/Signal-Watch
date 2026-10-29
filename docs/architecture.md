# Arquitetura — coleta e feed local

## Organização por responsabilidade

Reorganização solicitada pelo proprietário em 28/10/2026. Manter um único projeto Next.js e um worker separado, com os seguintes limites:

| Pasta                  | Responsabilidade                                            | Dependências internas permitidas     |
| ---------------------- | ----------------------------------------------------------- | ------------------------------------ |
| `src/app`              | Entradas do Next.js: páginas, layout e adaptadores de rotas | `frontend`, `api`                    |
| `src/frontend`         | Componentes React e estilos                                 | `shared` e HTTP para a API própria   |
| `src/api`              | Handlers HTTP, status/respostas e limitação de requisições  | `backend`, `shared`                  |
| `src/backend`          | Banco, consulta, coleta, regras editoriais e worker         | Outros módulos do backend e `shared` |
| `src/shared/contracts` | DTOs sem código de banco, React ou runtime Node             | Nenhuma camada da aplicação          |

`src/app/api` continua presente porque o App Router descobre os endpoints nesse caminho. Seus arquivos `route.ts` apenas declaram a configuração Next.js e exportam o handler de `src/api`; não contêm consultas ou regras de negócio. Os endpoints `/api/feed` e `/api/health/ready` foram preservados.

Fluxo de leitura: `frontend → HTTP → app/api → api → backend/feed → backend/database → PostgreSQL`; os dados retornam como DTOs de `shared/contracts`. Fluxo de coleta: `backend/worker → backend/ingestion → persistência + backend/editorial na mesma transação`. A camada backend não importa a camada HTTP nem componentes. Não foi adicionado servidor Express, monorepo ou serviço distribuído.

Ferramentas operacionais ficam em `scripts/database`, `scripts/editorial`, `scripts/checks` e `scripts/maintenance`. `scripts/local.mjs` permanece como inicializador. Configurações de Next.js, TypeScript, Drizzle e Vitest ficam na raiz; migrações e metadados ficam em `drizzle/`; testes permanecem em `tests/unit` e `tests/database`.

O ESLint verifica restrições de importação para registrar esses limites em código. Após a aprovação explícita do proprietário, foram executados lint, tipos, build, testes, contratos online, leitura HTTP e auditoria npm. O fluxo completo também foi validado em Docker isolado. Relatório atual em `docs/evidence/validation-after-refactor.json`; a conferência estática anterior foi preservada como registro histórico.

Na revisão do transporte, o cancelamento/prazo passou a abranger DNS e conexão em um mesmo orçamento. Resolução tardia não abre socket após cancelamento. A lista de endereços bloqueados inclui o bloco 192.88.99.0/24; referência consultada em 28/10/2026: [registro oficial IANA](https://www.iana.org/assignments/iana-ipv4-special-registry). Respostas de erro/redirect são encerradas com tratamento de erro do stream. A correção tem testes de regressão, incluindo DNS pendente, sinal já cancelado e orçamento compartilhado.

A imagem Docker mantém o diretório de trabalho e arquivos sob propriedade do usuário `node`, permitindo as ferramentas de desenvolvimento sem elevar a execução a root. Isso corrige o erro de permissão observado no carregamento da configuração Vitest no Linux.

## Decisões de implementação

Decisão de 28/10/2026: repositório inicialmente vazio, exceto AGENTS.md. Adotar Next.js/React/TypeScript para interface e endpoints, PostgreSQL com Drizzle para persistência e worker Node separado. Sem publicação, serviços pagos, Redis ou LLM nesta etapa.

A primeira entrega estabeleceu banco, migração, agendamento persistente, fila com lease, dois adapters tipados e ingestão idempotente de metadados. Após aprovação explícita do usuário, a segunda entrega acrescentou leitura local, projeção editorial e endpoint próprio. Não há notícias fictícias.

Separação: `src/backend/database` define armazenamento; `src/backend/ingestion` contém transporte, contratos e adapters; `src/backend/worker` orquestra a fila. Os adapters não conhecem banco nem React. Transporte aceita somente dois hosts HTTPS fixos e rotas construídas internamente, sem redirecionamento. URLs encontradas nas notícias não são acessadas.

O worker agenda e executa sem navegador. Uma transação grava itens, projeção editorial e cursor; lease vencido é recuperável, e um token impede commit por worker antigo. Execução at-least-once; unicidade por fonte/ID. Datas ausentes continuam nulas.

`src/backend/editorial` classifica metadados de forma conservadora, sem LLM: releases de repositório oficial verificado são anúncios oficiais; HN permanece relato comunitário. IA/tecnologia e empresas mencionadas no título são regras explícitas, não leitura do artigo nem prova de alegações. Títulos comunitários permanecem originais; títulos do Transformers usam português determinístico. Resumo/impacto continuam nulos quando não há informação suficiente.

Deduplicação editorial exige URL canônica idêntica e versão compatível. Links HN para a mesma release podem ser associados, preservando a origem da descoberta. Versões diferentes não se fundem; retag move a evidência e registra histórico. Mudanças de whitespace não criam versão factual. Datas de descoberta e ordenação são preservadas em republicações. Agrupamento semântico aproximado fica fora desta etapa.

`src/backend/feed` mantém validação de parâmetros, cursor, links e consulta independente do framework. Os DTOs ficam em `src/shared/contracts/feed.ts`; `src/api/feed` contém o handler HTTP e o limitador de requisições. A interface React consulta somente `/api/feed`; nenhum componente busca provedores. A leitura usa transação repeatable-read, ordenação por `sort_at DESC, id DESC`, cursor com filtros e microssegundos e FTS PostgreSQL `simple` indexado por GIN. A recência usa a publicação conhecida ao criar o evento, com descoberta como fallback explícito de ordenação, sem apresentar essa descoberta como publicação. Fontes oficiais precisam de evidência primária verificada utilizável; popularidade não altera status. Dados administrativos e configuração nunca entram no DTO.

Interface responsiva, abas oficiais/comunidade, busca, filtros de tema/fonte, carregamento por cursor, tema claro/escuro na sessão e detalhes de procedência. Status das fontes e cobertura parcial também acessíveis em seção móvel recolhível. Respostas antigas são canceladas ao trocar filtros. Sem timers React para coleta e sem publicação externa.

O núcleo guarda apenas metadados, sem autor, comentários, corpos de release ou HTML. GitHub só cadastra releases públicas do Transformers, cujo repositório é vinculado pela documentação oficial da Hugging Face. HN é exclusivamente sinal comunitário. O armazenamento não torna o conteúdo uma afirmação verificada.

Testes de unidade são offline. Testes de banco exigem PostgreSQL descartável separado e permissão explícita `ALLOW_DB_TESTS=1`. Contratos online são comando separado. Não testar nem migrar instalações existentes desconhecidas.

## Supabase, Vercel e conclusão dos fluxos do MVP — 29/10/2026

Complemento da revisão de segurança: endpoints reutilizam o pool por runtime através de `database/request-client`, enquanto scripts e worker continuam com conexões próprias e encerramento explícito. Isso impede que o limite de um cliente por pool seja multiplicado por cada requisição da mesma instância. Alterações de estado usam condições atômicas para preservar bloqueios e pausas concorrentes. Readiness tem limitação por processo; corpo administrativo tem prazo de cinco segundos. Cabeçalhos de proteção e demais controles estão documentados no [relatório de segurança](security-review-2026-10-29.md).

Autorização do proprietário: migrar o Radar para o projeto exclusivo Signal-Watch e concluir os recursos pendentes do MVP, usando Vercel Hobby. Não foram criadas contas, planos pagos, serviços adicionais ou uma segunda aplicação. A publicação da nova revisão fica pendente da configuração e aprovação final.

Preservada a divisão `app → api → backend`, com contratos em `shared`. As entradas Next.js delegam aos handlers; regras de administração, consultas de evento, sessão e orquestração permanecem no backend. Preferências e favoritos usam armazenamento local validado no frontend, sem banco de usuários antecipado. Nenhuma dependência nova foi adicionada.

PostgreSQL permanece como persistência única, agora também validado no Supabase PostgreSQL 17.11. Drizzle continua sendo a fonte das migrações: o bootstrap remoto reúne as três migrações existentes e seus hashes/timestamps no ledger Drizzle, evitando uma segunda árvore concorrente de schema. RLS foi habilitado nas oito tabelas públicas, sem políticas nem grants para clientes Supabase; somente o servidor acessa PostgreSQL. Os oito avisos informativos de RLS sem política são intencionais nesse modelo.

A conexão serverless usa Supavisor Transaction pooler, TLS com validação de certificado e pool de um cliente por instância. Migrações usam conexão direta/session separada. A URI não pode sobrescrever a verificação TLS. Não há SDK Supabase no navegador, chave pública de banco, prepared statements nomeados ou migrações durante o build.

O endpoint autenticado POST `/api/cron/ingest` reutiliza a mesma execução `runOne` do worker local e a fila PostgreSQL. Seu lote tem orçamento de 220 segundos, oito jobs no máximo e não reserva outro trabalho sem margem para fetch de 90 segundos e commit. O lease permanece de 180 segundos. Supabase Cron/pg_net/Vault foi escolhido porque o cron Vercel Hobby permite apenas execução diária; o script operacional só deve ser ativado após o deploy configurado e validado. Não há dependência de aba aberta ou timer React.

O feed ganhou filtros de tema, empresa, tipo, idioma, origem, período e status. Temas/empresas vêm de regras explícitas sobre metadados, não de leitura integral. Idioma desconhecido não é inferido; filtro de período usa publicação e exclui datas nulas. O cursor incorpora todos os filtros. Relevância tem pesos fixos: IA = 4, evidência primária verificada = 2; recência/UUID desempata. Novidade segue a ordenação original e deduplicação; interesse recebe peso zero por não haver métrica persistida. Não confundir esse ranking com grau de confirmação.

`/eventos/{id}` lê o evento por API própria, exibe as coberturas vinculadas e as últimas 100 alterações, sem publicar JSON bruto de histórico. Sem metadados suficientes, o resumo indica informação insuficiente. `/preferencias` mantém favoritos, lidos, tema e filtros preferidos exclusivamente no navegador, com esquema, limite de 1.000 registros e aviso de falha de armazenamento.

Administração: segredo aleatório de servidor, comparação em tempo constante, sessão HMAC de 12 horas, cookie HttpOnly/SameSite Strict/Secure em produção. CSRF usa origem pública configurada ou origem automática da Vercel, pois a URL interna Next pode ser diferente. Mutações exigem JSON e corpo limitado a 4 KiB. O painel cadastra GitHub Releases sem verificação; somente após revisão de propriedade/termos pelo administrador e health check real a fonte é ativada. O diagnóstico não promove HN a oficial nem atualiza o último sucesso de ingestão. Reprocessamento usa lotes de 100 e cursor, mantendo idempotência.

Limitações operacionais e passos de implantação, segredos, custos, backup e rollback estão em [deployment-supabase-vercel.md](deployment-supabase-vercel.md). A migração copiou os dados locais preservando a origem. A aplicação Vercel e o agendamento ainda precisam de validação com as variáveis reais; não estão declarados plenamente funcionais em produção.
