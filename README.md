# Radar de IA e Tecnologia

Aplicação para acompanhar lançamentos de IA e discussões da comunidade, consultar o acervo coletado e verificar a origem e as datas de cada item. Usa dados reais de duas integrações. O banco foi migrado para Supabase; a conexão e a coleta na Vercel ainda dependem da configuração e validação de produção. Não promete cobertura ampla da internet.

Instruções para o projeto existente: [Supabase e Vercel](docs/deployment-supabase-vercel.md). Não enviar senhas no chat ou ao GitHub.

## Estado atual

### Implementado

- Feed cronológico com paginação por cursor, busca no acervo e filtros por tema, origem e canal (oficial ou comunidade).
- Procedência, links originais, datas de publicação/coleta e estado da última coleta exibidos na interface.
- Coleta independente do navegador, com worker, fila persistente, tentativas, leases recuperáveis e gravação idempotente em PostgreSQL.
- Classificação editorial conservadora: releases do repositório verificado são apresentadas como anúncios oficiais; Hacker News permanece separado como conteúdo comunitário.
- Tema claro/escuro, estados de carregamento/erro/vazio e endpoint de prontidão.
- Filtros avançados por tema, empresa, tipo, idioma, origem, período e status; ordenação por recência ou relevância com cursor.
- Página `/eventos/{id}` com evidências, cobertura vinculada e histórico. Sem resumo inventado quando faltam informações.
- `/preferencias` com favoritos, itens lidos, tema e preferências locais, sem cadastro.
- `/admin` protegido, com cadastro GitHub Releases não verificado, diagnóstico após revisão documental, intervalos, pausa, saúde, quotas e reprocessamento idempotente em lotes.
- Endpoint POST autenticado `/api/cron/ingest`, com execução limitada para serverless; script de ativação Supabase Cron/Vault, ainda não ativado em produção.
- Ambiente local e Docker Compose; as validações registradas incluem build, testes, contratos reais das integrações e fluxo de coleta persistido. Consulte [docs/implementation-status.md](docs/implementation-status.md) para escopo e evidências.

### Ainda pendente

- Mais fontes verificadas e maior cobertura de empresas e produtos.
- Configurar variáveis da Vercel, publicar a revisão aprovada e validar funcionamento real em produção.
- Ativar e validar Supabase Cron/Vault, incluindo coleta com navegador fechado.
- Validar backup/restauração conforme o plano Supabase e fazer revisão visual com navegador.

Não há conteúdo de demonstração disfarçado de notícia real. Resumos não são inventados quando os metadados coletados não dão informação suficiente.

## Fontes disponíveis

| Integração                                       | Papel no produto                           | Limites atuais                                                         |
| ------------------------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------- |
| GitHub REST Releases — Hugging Face Transformers | Releases do projeto associado e verificado | Janela e páginas limitadas; não coleta corpos completos das releases   |
| Hacker News API oficial                          | Descoberta de discussões da comunidade     | Sinal comunitário, não confirmação; a janela pode deixar itens de fora |

As fontes, documentação consultada, condições e limitações estão em [docs/sources.md](docs/sources.md). Reddit, arXiv, feeds de blogs e provedores licenciados não estão implementados/ativos. Não é necessária chave de LLM; não há integração de LLM.

## Requisitos

- Node.js 22.12 ou superior e npm.
- PostgreSQL 18 para execução local, ou Docker com Docker Compose.
- No Windows, use `npm.cmd` caso a política do PowerShell bloqueie `npm.ps1`; não é necessário alterar a política.

## Executar localmente

Instale dependências e crie sua configuração local:

```powershell
npm.cmd ci
Copy-Item .env.example .env
```

Configure `POSTGRES_PASSWORD` e `DATABASE_URL` no `.env` com os dados do PostgreSQL que você controla. Codifique caracteres especiais da senha na URL. Não use credenciais reais em exemplos, commits ou logs. O `.env` é ignorado pelo Git.

Se estiver usando o PostgreSQL do Compose, inicie o banco e use o host `db` na `DATABASE_URL` para processos dentro de contêineres:

```powershell
docker compose up -d db
npm.cmd run db:migrate
npm.cmd run db:seed
```

Para executar scripts no Windows diretamente no computador, a URL deve usar `127.0.0.1` e a porta publicada do banco.

O teste online faz chamadas reais às fontes; `--activate` ativa as integrações apenas depois da validação:

```powershell
npm.cmd run test:online -- --activate
npm.cmd run build
npm.cmd run local
```

`npm run local` aplica migrações e a projeção editorial, inicia o site em `http://127.0.0.1:3000` e mantém a coleta em processo separado. Exige um build prévio e um banco configurado. Para apenas processar os jobs devidos uma vez, use `npm.cmd run collect:once`; para manter o worker agendando e coletando continuamente sem iniciar o site, use `npm.cmd run worker`.

## Executar com Docker Compose

Configure o `.env` com a `DATABASE_URL` usando o host `db`. O Compose aplica migrações e inicia banco, aplicação e worker:

```powershell
docker compose up --build -d
docker compose run --rm worker npm run db:seed
docker compose run --rm worker npm run test:online -- --activate
docker compose logs -f worker
```

O volume do PostgreSQL preserva os dados entre reinícios. O fluxo Compose e a coleta em contêiner foram validados conforme [o relatório de implementação](docs/implementation-status.md); isso não equivale a uma implantação pública ou a uma garantia operacional em produção.

## Verificações

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run format:check
```

Os testes de banco podem alterar e limpar tabelas: use exclusivamente uma base descartável cujo nome seja `radar_test` ou `radar_test_*`. É necessário ativar explicitamente a permissão:

```powershell
$env:ALLOW_DB_TESTS='1'
$env:TEST_DATABASE_URL='postgresql://USUARIO:SENHA@127.0.0.1:5432/radar_test'
npm.cmd run test:db
```

Testes online são separados da suíte offline e precisam de rede. Resultados já executados e respectivas limitações estão em [docs/implementation-status.md](docs/implementation-status.md) e em [docs/evidence/](docs/evidence/).

## Operação e segurança

- A interface lê os dados persistidos pela API própria; abrir o site não consulta os provedores.
- A coleta contínua disponível no fluxo validado é feita pelo worker, independentemente de uma aba aberta.
- `GET /api/health/ready` verifica dependências essenciais sem expor detalhes de conexão.
- A área administrativa autenticada ainda não existe. A rota `POST /api/cron/ingest` presente no estado de trabalho atual exige `CRON_SECRET`, mas não há agenda configurada em `vercel.json`; essa alternativa não está pronta como coleta agendada.
- O transporte dos adapters aceita apenas hosts e caminhos conhecidos em HTTPS, bloqueia destinos não públicos, rejeita redirecionamentos e limita tempo e tamanho da resposta. URLs encontradas em notícias não são acessadas.
- Segredos ficam no servidor. Não configure credenciais em variáveis `NEXT_PUBLIC_*`.
- Custos de hospedagem, banco gerenciado e serviços externos não foram verificados; nenhum serviço foi contratado.

### Backup e restauração

Execute `pg_dump` e `pg_restore` em uma instalação PostgreSQL apropriada, usando um mecanismo seguro para autenticação; não coloque senhas diretamente no comando:

```text
pg_dump --format=custom --file=radar.backup --dbname=radar
pg_restore --dbname=radar_restore --no-owner radar.backup
```

Restaure primeiro em uma base separada e valide os dados antes de qualquer troca. O volume Docker não substitui backup; restauração automatizada ainda não foi validada. Migrações ficam em `drizzle/` e não possuem rollback automático.

As decisões e os limites das camadas estão em [docs/architecture.md](docs/architecture.md); o registro de testes e pendências está em [docs/implementation-status.md](docs/implementation-status.md).
