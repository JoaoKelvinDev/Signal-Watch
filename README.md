# Radar de IA e Tecnologia

Primeira etapa do projeto orientado por [AGENTS.md](AGENTS.md): base de coleta local com dois conectores reais, PostgreSQL, fila e worker independente do navegador. **MVP ainda incompleto:** feed, eventos editoriais, filtros, busca, favoritos e administração ficam para a próxima etapa autorizada. A página atual informa esse estado e não contém notícias fictícias.

## Requisitos e setup

Node.js 22.12+ (testado em 22.20.0), npm e PostgreSQL 18. Lockfile versionado. No Windows, usar `npm.cmd` se a política do PowerShell bloquear `npm.ps1`; não é necessário mudar a política.

```powershell
npm.cmd ci
Copy-Item .env.example .env
```

Preencha `POSTGRES_PASSWORD` e `DATABASE_URL` no `.env` com valores locais. Codifique caracteres especiais da senha na URL. Sem token GitHub, LLM ou Reddit, o núcleo funciona.

Para Docker Compose, use host **db** na DATABASE_URL. Para executar scripts no computador com banco via porta publicada, use host **127.0.0.1**. O `.env` é ignorado no Git e no build Docker. Nunca usar senha de exemplo em implantação real.

```powershell
docker compose up -d db
# Após configurar DATABASE_URL para o banco local desejado:
npm.cmd run db:migrate
npm.cmd run db:seed
# Faz chamadas externas reais; ativa fontes somente após validar resposta/configuração.
npm.cmd run test:online -- --activate
npm.cmd run collect:once
npm.cmd run worker
```

O último comando continua agendando enquanto o processo estiver em execução. Não depende de página aberta. `collect:once` drena os jobs devidos e termina, sem aguardar retries futuros. O seed é idempotente e não sobrescreve configuração existente. Scripts leem `.env` pelo suporte nativo do Node; variáveis já definidas no processo têm precedência.

Para aplicação e worker em contêineres, configure `DATABASE_URL` com host `db`, depois:

```powershell
docker compose up --build -d
docker compose run --rm worker npm run db:seed
docker compose run --rm worker npm run test:online -- --activate
docker compose logs -f worker
```

Compose aplica migrações antes de iniciar app/worker e mantém volume persistente. O build da imagem e o fluxo Compose ainda não foram executados: daemon Docker indisponível nesta sessão. A imagem contém ferramentas de desenvolvimento para este ambiente local; endurecimento de implantação fica pendente. Sem publicação ou contas criadas.

## Validação

```powershell
npm.cmd run lint    
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run format:check
```

Testes de banco aplicam migração duas vezes e limpam tabelas: use **somente banco descartável** cujo nome seja `radar_test` ou `radar_test_*`. O programa recusa outros nomes e exige opt-in separado:

```powershell
$env:ALLOW_DB_TESTS='1'
$env:TEST_DATABASE_URL='postgresql://USUARIO:SENHA@127.0.0.1:5432/radar_test'
npm.cmd run test:db
# Rede real, separado da suíte offline:
npm.cmd run test:online
```

Fixtures dos testes são isoladas do catálogo de produção. Não existe modo de demonstração no site. Cobertura detalhada e resultados em [docs/implementation-status.md](docs/implementation-status.md).

## Operação e segurança

`GET /api/health/ready` verifica conexão e tabela essencial; retorna 503 sem detalhes de conexão em falhas. Não há endpoint público de coleta nem painel administrativo sem proteção: essas rotas ainda não existem. A aplicação nunca consulta provedores ao abrir páginas.

Os dois adapters permitem apenas hosts e caminhos fixos em HTTPS. O transporte resolve DNS a cada requisição, recusa endereços reservados, fixa IPv4 público no socket, rejeita redirecionamentos, limita resposta a 2 MiB e requisição a 15 segundos. O ciclo possui prazo de 90 segundos, dentro do lease de 180 segundos. Não existe entrada para URLs de feeds arbitrários nesta fase. Não há parser XML, execução de Markdown/HTML ou envio de dados a LLM.

Lease recuperável e token impedem commit de worker antigo. Cursor e metadados são persistidos na mesma transação. Cinco tentativas por job, backoff exponencial e jitter; quota pode impor espera maior. Último sucesso difere de última tentativa. Truncamento de janela fica visível no estado da fonte. Logs contêm somente códigos de erro controlados, slug e contagens.

Backup de um banco configurado (credenciais via mecanismo seguro do PostgreSQL, nunca no comando):

```text
pg_dump --format=custom --file=radar.backup --dbname=radar
pg_restore --dbname=radar_restore --no-owner radar.backup
```

Use ambiente de restauração separado e valide contagens/migrações antes de trocar o banco. Migrações ficam em `drizzle/` e são aplicadas por `db:migrate`; não existe rollback automático. Volume Docker não substitui backup. Retenção automatizada e restauração de backup ainda não foram validadas.

O PostgreSQL temporário usado nos testes desta sessão fica em `.local/postgres`, porta 55439, com autenticação trust limitada a loopback. É exclusivo de testes e foi desligado ao fim da etapa; não usar essa configuração em produção. Nenhum serviço PostgreSQL existente foi iniciado ou alterado.

Veja [arquitetura](docs/architecture.md), [fontes e termos](docs/sources.md) e [estado da implementação](docs/implementation-status.md).
