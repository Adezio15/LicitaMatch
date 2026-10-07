# Links oficiais de oportunidades

## Captura e armazenamento

O catálogo é `licitacoes_pncp`. Não havia coluna de URL; `origem` já identifica a fonte e foi reaproveitada (PNCP / Compras.gov.br na interface). A migration `013_opportunity_official_url.sql` adiciona somente `link_edital`, opcional.

Os normalizadores JSON de PNCP e Compras.gov.br preservam links explicitamente enviados no registro, nesta ordem: `linkEdital`, `urlEdital`, `link_edital`, `urlOportunidade`, `url_oportunidade`, `linkProcessoEletronico`, `urlProcessoEletronico`, `linkSistemaOrigem`. São alternativas de compatibilidade; nem todos esses campos existem em todos os feeds. Um campo inválido é ignorado e a próxima alternativa é avaliada. A prioridade favorece documento, página específica, processo e portal de origem.

PNCP: a documentação oficial descreve `linkSistemaOrigem` e `linkProcessoEletronico` (https://pncp.gov.br/manual/pt-br/latest/singlehtml/index.html). Uma consulta pública em 07/10/2026 retornou ambos os campos em 10 registros, com algum link preenchido em 6. Isso não garante disponibilidade para toda contratação. Compras.gov.br: o normalizador aceita os mesmos campos quando presentes; não há suposição de preenchimento. A consulta de amostra ao endpoint utilizado não retornou registros, portanto não foi possível confirmar URL preenchida nessa fonte. O fallback HTML atual extrai texto e não estabelece associação confiável entre cada âncora e a contratação; portanto não atribui links genéricos da página aos registros.

URLs precisam ser absolutas HTTP/HTTPS, com hostname, sem credenciais, espaços internos, caracteres de controle ou barras invertidas e até 4096 caracteres. A validação ocorre na normalização e novamente na persistência. Ela valida formato, não garante disponibilidade futura do site nem transforma uma URL em fonte oficial; a procedência é o registro retornado pelo importador oficial. O servidor não acessa URLs de destino durante a importação.

Não se constrói URL a partir do código PNCP. Os links antes montados nas views foram removidos. Sem URL da fonte, `link_edital` fica `NULL`, a interface informa “Link oficial não disponibilizado pela fonte” e não apresenta botão. Registros antigos recebem links na reimportação pelo código externo; ausência/URL inválida em reimportações não apaga um link válido anterior. Não há backfill de URLs presumidas nem alteração da assinatura de deduplicação.

## API e interface

`/api/busca` e `/api/oportunidades` entregam somente resumo para `sem_plano`, sem `items`, `link_edital` ou URL. O detalhe continua bloqueado com 403. Start, Pro e Premium recebem o link nos endpoints permitidos. A proteção é feita no servidor, antes da consulta dos detalhes; o plano não é aceito da query string. As permissões existentes não foram alteradas.

Busca, listagem de matches e detalhe usam o botão “↗ Ver edital” com `target="_blank"` e `rel="noopener noreferrer"`. O detalhe exibe a fonte. Cálculo de match, mínimo, pesos e filtros permanecem iguais.

## Publicação e teste

1. Execute `npm run db:migrate` no ambiente configurado antes de servir a nova versão (`npm start` já executa migrations). A migration ainda não foi aplicada em produção por este trabalho.
2. Execute `node --test --test-isolation=none test/officialLinks.test.js test/pncp.test.js test/comprasnet.test.js test/plans.test.js test/premiumTrials.test.js test/regionalRule.test.js`.
3. Importe um registro cuja fonte tenha URL preenchida. Com Start, Pro ou Premium, confira `/busca`, `/oportunidades` e `/oportunidades/:id`; o botão abre exatamente o link persistido em nova aba.
4. Com `sem_plano`, consulte `/api/busca` e `/api/oportunidades`, inclusive com `?plano=premium`: somente resumo, nenhum link. O detalhe retorna 403.
5. Confira um registro sem link: mensagem de ausência, sem botão e sem URL sintetizada.

Arquivos desta implementação: `migrations/013_opportunity_official_url.sql`, `src/services/sources/officialUrl.js`, `src/services/sources/pncpSource.js`, `src/services/sources/comprasnetSource.js`, `src/services/pncpPersistenceService.js`, `src/services/opportunityService.js`, `src/views/partials/officialLink.ejs`, `src/views/account/search.ejs`, `src/views/account/opportunities.ejs`, `src/views/account/opportunity.ejs`, `test/officialLinks.test.js` e este documento.
