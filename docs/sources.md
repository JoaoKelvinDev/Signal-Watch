# Fontes — verificação em 28/10/2026

Escopo desta etapa: experimento local de ingestão de metadados, sem distribuição pública, comentários, corpos completos ou LLM. O seed cria fontes **não verificadas**; `test:online -- --activate` verifica resposta real e ativa apenas as configurações conhecidas do catálogo. Sucesso no transporte não comprova alegações do conteúdo.

## GitHub Releases — Hugging Face Transformers

- Documentação: https://docs.github.com/en/rest/releases/releases
- Propriedade: a documentação do emissor https://huggingface.co/docs/transformers/en/installation aponta para `huggingface/transformers`.
- Licença do projeto consultada: https://github.com/huggingface/transformers/blob/main/LICENSE (Apache-2.0). Isso não é uma licença universal para conteúdo de terceiros em release notes.
- Termos: https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#h-api-terms
- Limites: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- Endpoint real: `GET https://api.github.com/repos/huggingface/transformers/releases?per_page=30&page=1`. API versionada `2026-03-10`, indicada nos exemplos oficiais consultados.
- Autenticação: opcional para recursos públicos. Sem token: limite principal documentado de 60 requisições/hora por IP; outros consumidores do mesmo IP compartilham esse limite. Token opcional somente de leitura; sem permissões de escrita.
- Cadência: 15 minutos mais jitter de até 10%. Até duas páginas/ciclo (192 consultas/dia antes de retries, diagnóstico e testes). Cabeçalhos de quota armazenados; 403 de quota e 429 aguardam `Retry-After`/reset. 401/403 sem evidência de quota bloqueiam a fonte.
- Contrato: somente releases publicadas, sem drafts; preserva versão, prerelease e published_at nulo. Texto de release descartado. Idioma desconhecido permanece nulo.
- Janela limitada: percorre até 60 registros, retém os publicados nos últimos sete dias e aqueles sem data conhecida. Não assume ordenação por publicação. Se houver próxima página, registra `WINDOW_TRUNCATED`: não garante cobertura integral dos sete dias. ETag/Last-Modified só são guardados quando o snapshot ocupa uma página, para evitar ocultar mudanças nas páginas seguintes.
- Estado observado: contrato real e persistência concluídos. O limite de páginas foi atingido. Não reconciliamos remoções nem edições fora da janela nesta etapa.

## Hacker News — API oficial

- Documentação e propriedade: https://github.com/HackerNews/API
- Endpoints: `https://hacker-news.firebaseio.com/v0/newstories.json` e `item/{id}.json`.
- Termos consultados: https://www.ycombinator.com/legal/ e https://news.ycombinator.com/newsguidelines.html. A API fornece deliberadamente acesso público; isso não transfere direitos sobre postagens ou páginas externas. A licença MIT do repositório da documentação não é atribuída ao conteúdo dos usuários.
- Sem credenciais. A documentação informa ausência de limite de taxa no momento; não é garantia permanente ou autorização para carga irrestrita.
- Cadência: 30 minutos mais jitter. Uma consulta da janela e até 25 detalhes sequenciais/ciclo: até 1.248 consultas/dia, antes de retries e testes. Na ausência de IDs novos, apenas uma consulta/ciclo.
- Incremental dentro da janela de newstories: primeiro ciclo consulta as últimas 25 histórias, marcando as anteriores como fora do backfill inicial. Nos ciclos seguintes, mantém IDs vistos que ainda estão na janela e consome pendentes mais antigas primeiro. Pendentes fora do limite ficam para depois; se um ID desaparecer da janela antes da coleta, pode ser perdido. Sem promessa de cobertura completa, atualização de popularidade ou reconciliação de exclusões.
- Somente ID, título, URL e data, sem autor, texto ou comentários. Título recebido é texto não confiável; nenhuma instrução é executada. Publicação HN é o horário da submissão, não a publicação do artigo original. Link da discussão separado do link externo, que não é acessado pelo worker.
- Estado observado: contrato real e persistência de 25 itens concluídos. Origem comunitária, sem promoção automática a anúncio oficial. Retenção ampliada, uso comercial e exibição pública precisam ser revistos antes de habilitar a distribuição do produto.

## Pendências registradas

Feeds oficiais de blogs: **não verificados**, nenhum endpoint inventado. Conector de feed ainda não implementado. arXiv: opcional e não implementado. Reddit: desativado, pendente de aprovação da plataforma e credenciais; política deve ser revalidada antes de implementar. Provedor de notícias/busca: não contratado, orçamento e licença pendentes. Google Custom Search não é dependência do projeto. Nenhuma dessas pendências impede os dois conectores locais.

Custos de hospedagem, tráfego, armazenamento e eventual plano de terceiros **não verificados**. Nenhum serviço foi contratado. As cadências atuais somam até 1.440 consultas/dia antes de retries/páginas adicionais/testes; não prometer gratuidade operacional.

Evidências sanitizadas do banco: [evidence/ingestion.json](evidence/ingestion.json). Os testes online são separados dos testes offline.
