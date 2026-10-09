# Fontes oficiais e relatórios

A migration `012_official_links.sql` acrescenta `licitacoes_pncp.url_fonte` e `cidade`. Registros antigos permanecem sem link até que uma nova coleta forneça o endereço. Não há backfill baseado em identificadores ou URLs presumidas.

## Origem dos links

Os adaptadores preservam os links recebidos no registro: edital/contratação, processo eletrônico, sistema de origem ou página informada pela fonte. Um endereço específico tem preferência sobre a página inicial do portal. Somente URLs HTTP/HTTPS válidas, sem credenciais embutidas, são aceitas. Não há restrição a domínios `.gov.br`, pois fontes oficiais podem indicar plataformas contratadas.

No scraping, um único link de edital/processo encontrado na página pode ser resolvido contra o endereço efetivamente consultado. Sem um link inequívoco, usa-se a própria página consultada. Nunca se monta uma URL a partir de CNPJ, ano ou número da licitação. Se a fonte não informar nenhum endereço, a interface, o e-mail e o PDF mostram **Link oficial não disponível**. URLs são atribuídas à fonte que as informou; o sistema não afirma ter verificado sua disponibilidade em tempo real.

A reimportação atualiza links e cidades sem apagar metadados quando estes faltam no novo retorno. Duplicatas por assinatura também podem receber os metadados, e um link específico conhecido não é substituído por uma página inicial genérica.

Oportunidades e busca por segmento oferecem **Consultar fonte oficial**, com nova aba e `noopener noreferrer`. E-mails possuem o link tanto no HTML quanto no texto simples. O template existente do WhatsApp foi preservado.

Referência dos campos `linkSistemaOrigem` e `linkProcessoEletronico`: [Manual de integração do PNCP](https://pncp.gov.br/manual/pt-br/latest/singlehtml/). A geração de documentos usa [PDFKit](https://pdfkit.org/docs/text.html), incluindo anotações de links clicáveis.

## Relatórios Premium

Página: `/relatorios`. API: `/api/relatorios`. PDFs: `/relatorios/pdf` e `/api/relatorios/pdf`. Todos exigem autenticação e plano Premium no backend, inclusive exportação e consultas diretas. O identificador da empresa vem da sessão, nunca dos filtros enviados.

Tipos (`tipo`):

- `oportunidades`: uma linha por licitação, com o maior match dentre os interesses e período filtrados. Inclui objeto como título, órgão, cidade/UF, interesse, percentual, data de identificação, data de abertura/publicação disponível na fonte, situação atual e link oficial.
- `matches`: contagem de matches por faixa (1–24, 25–49, 50–74 e 75–100%) e percentual médio. Um match representa um par interesse/licitação; não é uma contagem de licitações únicas.
- `alertas`: somente envios confirmados, por canal e data. O histórico legado de e-mail não é contado novamente quando já foi migrado para `alertas_empresa_email`.
- `mensal`: oportunidades distintas por mês, matches, score médio, matches atualmente aceitos e quantidades de e-mails/WhatsApp enviados. Meses sem atividade aparecem com zero. Não representa taxa de vitória em licitações.

Filtros: `inicio`, `fim` (YYYY-MM-DD, inclusivos), `interesse` (ID), `orgao` (trecho do nome), `estado` (UF), `match_min` e `match_max` (0 a 100). Todos são aplicados em conjunto. O período padrão são os últimos 30 dias, usando UTC−3. Para oportunidades e matches, o período considera a identificação do match; para alertas, considera `enviado_em`. No desempenho mensal cada indicador usa a data do seu evento. Situação e percentual são os valores atuais, pois não existe histórico de alterações de status/score. Interesses inativos continuam disponíveis para consulta histórica.

A tela pagina em 25 linhas. O PDF aplica os mesmos filtros e exporta todas as páginas, com limite de 2.000 linhas. Acima disso, retorna HTTP 422 solicitando filtros mais específicos, sem truncar silenciosamente. O parâmetro `page` não restringe o PDF. As URLs são clicáveis no PDF e também aparecem por extenso.

A API mantém `items` como resumo por situação para compatibilidade com o relatório anterior e acrescenta `rows`, `total`, `pages`, `filters` e `tipo` para as novas visões.

## Validação

`test/officialLinks.test.js` cobre normalização das fontes, fallback, URLs inseguras, reimportação, deduplicação e links no envio automático. `test/reports.test.js` cobre filtros, limites de datas no fuso local, métricas mensais, isolamento, planos, renderização HTML, conteúdo/anotações dos PDFs e exportação de múltiplas páginas.

Aplicação do schema pelo fluxo existente: `npm run db:migrate` (também executado por `npm start`). Nenhuma credencial de fornecedor é necessária para os testes.
