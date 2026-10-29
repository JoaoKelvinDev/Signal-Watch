# Implantação: Supabase e Vercel Hobby

Revisão: 29/10/2026. Projeto existente: **Signal-Watch**, Supabase `bfkqabspjedvasayvpyh`, região us-east-2. Aplicação existente: https://signal-watch-ten.vercel.app. Não criar outro projeto.

## Estado da migração

As três migrações Drizzle foram aplicadas no Supabase por um bootstrap revisado, com ledger `drizzle.__drizzle_migrations` preservado. As oito tabelas estão com RLS, sem políticas públicas e sem permissões para `anon`/`authenticated`. Isso é intencional: o navegador acessa os endpoints Next.js, e o servidor acessa PostgreSQL. Não usar chave `service_role` no cliente nem adicionar `NEXT_PUBLIC_DATABASE_URL`.

Foram copiados 126 itens, 126 eventos, 126 evidências, duas fontes e 13 execuções, com IDs e timestamps preservados; sem evidências órfãs na conferência. A origem local foi preservada. Exportações ficam em `.local/`, ignorado no Git. Uma nova execução de bootstrap/transferência contra destino populado é recusada. Não executar esses scripts novamente no projeto existente.

## Configurar variáveis

Estado em 29/10/2026: o proprietário confirmou o cadastro das três variáveis obrigatórias em Production. Os valores permanecem privados; a conexão ainda precisa ser validada após publicar o código atualizado. As instruções abaixo permanecem como referência para manutenção.

1. No Supabase, selecionar Signal-Watch → **Connect → Transaction pooler**. Copiar a URI indicada pelo painel, porta **6543**, e preencher a senha do banco. Usar a região/host/usuário exibidos pelo painel; não deduzir esses valores.
2. Na Vercel, abrir o projeto existente → **Settings → Environment Variables**. Cadastrar para **Production**:

| Variável           | Valor                                                                       |
| ------------------ | --------------------------------------------------------------------------- |
| `DATABASE_URL`     | URI Transaction pooler, preenchida com a senha do banco                     |
| `ADMIN_PASSWORD`   | Senha aleatória exclusiva, 32 a 256 caracteres                              |
| `CRON_SECRET`      | Outro segredo aleatório exclusivo, pelo menos 32 caracteres                 |
| `DATABASE_CA_CERT` | Opcional: CA do Supabase, caso exigida pela conexão; manter verificação TLS |
| `GITHUB_TOKEN`     | Opcional: token de leitura de dados públicos; sem permissões de escrita     |

Gerar segredos com gerenciador de senhas. Não enviar no chat, cadastrar no GitHub ou usar prefixo `NEXT_PUBLIC_`. Uma senha do banco com caracteres reservados precisa estar codificada na URI conforme orienta o painel. Certificado inválido deve ser corrigido com CA/host adequados; não desativar `rejectUnauthorized`.

Opcionalmente, configurar `APP_ORIGIN=https://signal-watch-ten.vercel.app` para a proteção CSRF. Na Vercel, a origem usa automaticamente `VERCEL_PROJECT_PRODUCTION_URL` quando disponível. Ao usar domínio próprio, configurar `APP_ORIGIN` com a origem HTTPS desse domínio. A URL interna do servidor pode diferir da origem pública.

Não configurar o banco de produção para Preview. O cron recusa ambientes Vercel diferentes de Production. A conexão usa no máximo um cliente por pool/instância; isso não é um limite global de conexões. O projeto não usa prepared statements nomeados.

`MIGRATION_DATABASE_URL` é somente para comandos de migração executados pelo operador, com conexão direta ou Session pooler, porta 5432. Não é necessária no runtime Vercel. Não executar migrações no build: os builds devem funcionar sem acesso ao banco e previews não devem alterar produção.

## Publicar e conferir

Após revisar/aprovar os testes e enviar as alterações ao GitHub, executar o deploy no projeto Vercel existente. Framework Next.js, raiz do repositório, instalação pelo lockfile, build `npm run build`. Usar Node 22 e Fluid Compute com suporte ao limite de 300 segundos da função de coleta. O repositório não ativa cron nativo da Vercel.

Conferir `/api/health/ready`, `/`, `/preferencias`, `/admin`, `/eventos/{id}`. Fazer login administrativo, testar busca/filtros e links de evidência. Uma chamada POST a `/api/cron/ingest` sem Bearer deve retornar 401 com `CRON_SECRET` configurado. GET não executa coleta. Administração exige Origin exata e JSON para alterações; endpoints não aceitam chamadas cross-origin.

## Ativar a coleta independente de visitas

O cron nativo da Vercel Hobby só permite uma execução diária, inadequada para esta coleta. Usar Supabase Cron (`pg_cron`) + `pg_net` chamando o endpoint Node protegido:

1. Após o deploy validado, ativar as extensões **pg_cron** e **pg_net** no painel Supabase.
2. No **Vault**, criar `radar_cron_secret` com exatamente o valor de `CRON_SECRET` configurado na Vercel. Não colocar esse valor em SQL versionado.
3. Revisar e executar [enable-supabase-cron.sql](../scripts/deployment/enable-supabase-cron.sql) no SQL Editor do Signal-Watch. O script valida pré-requisitos e agenda `radar-ingestion` a cada cinco minutos, com timeout HTTP de 250 segundos. Reutilizar o mesmo nome atualiza o agendamento.
4. Conferir o histórico do job e as respostas `net._http_response`, sem imprimir cabeçalhos de requisição ou o Vault. HTTP 200/207 confirma a execução HTTP; confirmar também `ingestion_runs`, itens persistidos e último sucesso por fonte. Uma fonte pode falhar sem impedir a outra.
5. Fechar o navegador, aguardar mais de um ciclo e conferir avanço de `ingestion_runs`/último sucesso. Isso ainda precisa ser validado em produção.

O endpoint agenda fontes devidas e processa no máximo oito jobs por chamada, com orçamento de 220 segundos e margem antes de reservar outro job. Fetch tem limite de 90 segundos; lease de 180 segundos permite recuperação de interrupções. São escritas idempotentes, com entrega ao menos uma vez. Não é promessa de processamento exatamente uma vez nem de latência garantida.

Agendamento a cada cinco minutos gera aproximadamente 288 chamadas/dia à função, inclusive ciclos sem trabalho. Com intervalos atuais, GitHub 15 minutos e HN 30 minutos: até 192 consultas GitHub/dia (duas páginas) e até 1.248 consultas HN/dia (lista + 25 detalhes), antes de retries e diagnósticos. Tokens, quotas e tráfego compartilhado podem alterar o resultado. Verificar limites atuais dos planos; não há garantia de custo zero. Monitorar fila, quotas, falhas, duração e armazenamento. Histórico de cron cresce e precisa de retenção operacional; não foi ativada limpeza automática destrutiva.

## Administração e operação

`/admin` permite cadastrar fontes GitHub Releases como não verificadas, registrar evidência de propriedade/permissões, confirmar revisão documental e testar conexão antes de ativar. A confirmação é uma decisão editorial do administrador: um HTTP 200 não comprova propriedade ou direitos. Não cadastrar um repositório só por ter nome parecido com o emissor. HN continua comunitário.

O painel permite pausar/retomar fontes verificadas, mudar intervalo (mínimo cinco minutos), consultar saúde/quotas/últimas execuções e reprocessar metadados em lotes idempotentes de 100, com continuação por cursor. Uma coleta já reservada pode terminar após pausa. O diagnóstico não substitui coleta persistida, por isso não atualiza último sucesso de ingestão. Fontes bloqueadas exigem revisão e novo diagnóstico.

Sessões assinadas duram 12 horas; cookie HttpOnly, SameSite Strict e Secure em HTTPS. Logout remove o cookie do navegador. Rotacionar `ADMIN_PASSWORD` invalida todas as sessões; uma cópia prévia do cookie permanece válida até expirar sem essa rotação. O limitador de login/feed é por instância, não distribuído: usar segredo aleatório forte e regras de firewall da plataforma conforme disponibilidade do plano. Não foi implementado cadastro público.

Favoritos/lidos/preferências ficam somente no navegador, até 1.000 registros. Títulos salvos são rótulos locais e podem ficar antigos; a página do evento lê a versão atual. Sem sincronização entre dispositivos. Idiomas não fornecidos permanecem desconhecidos; não são inferidos pelo título. Resumos de IA continuam opcionais e desativados.

## Backup, restauração e reversão

Antes de migrações futuras, confirmar backup disponível no plano Supabase e testar restauração em banco separado. Se não houver backup gerenciado suficiente, usar `pg_dump` por conexão direta/session em ambiente seguro, armazenando o dump fora do Git; nunca salvar credenciais no comando ou no relatório. Não há garantia de recuperação sem backup verificado.

Para interromper a coleta, pausar `radar-ingestion` no painel Cron e as fontes no painel administrativo. Fazer rollback da versão da aplicação na Vercel não reverte automaticamente o schema. Não apagar o Supabase nem o banco local para reverter. A transferência preservou a origem; restauração deve ser ensaiada em outro banco antes de alterar produção.

## Referências oficiais verificadas

- [Conexões PostgreSQL e pooler](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [TLS e certificado](https://supabase.com/docs/guides/platform/ssl-enforcement)
- [Supabase Cron](https://supabase.com/docs/guides/cron/quickstart)
- [pg_net e timeout](https://supabase.com/docs/guides/database/extensions/pg_net)
- [Limites do cron Vercel](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Limites das funções Vercel](https://vercel.com/docs/functions/limitations)

O changelog Supabase foi consultado nesta implementação: as mudanças de extensões/operações PostgreSQL 17.11 não introduzem dependência nova para este schema; a retirada anunciada de cifras CBC nas APIs HTTP não exige desabilitar TLS. Revalidar contratos antes da ativação de novos serviços.
