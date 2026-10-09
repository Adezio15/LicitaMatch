# Integrações de fontes

## Fontes conectadas

O registro padrão inclui 59 das 104 fontes do catálogo: PNCP, Compras.gov.br, as 28 regionais do Senac (incluindo DN), as 28 regionais do Sesc (incluindo DN) e Recife. Os 57 novos conectores não exigem credenciais. A coleta usa o mesmo fluxo de persistência, deduplicação e correlação das fontes existentes.

| Fonte | Serviço oficial | Consulta |
| --- | --- | --- |
| Senac | `https://transparencia.senac.br/service/api/licitacoes/regional/{regional}` | Snapshot por regional; paginação local e cache de cinco minutos durante a continuação. |
| Sesc | `https://transparencia-{regional}.sesc.com.br/transparencia/dados/api/216` | Licitações em andamento; parâmetros `page` e `page_size`. |
| Recife | `https://dados.recife.pe.gov.br/api/3/action/datastore_search` | Recurso `9771bedc-6f2e-43f0-bd4c-25b0de5500b5`; `limit`, `offset` e ordenação por `_id`. |

Referências primárias:

- [Portal de transparência Senac](https://transparencia.senac.br/#/dn/licitacoes). O JavaScript servido pelo próprio portal chama o endpoint regional acima.
- [Dicionário oficial Sesc — licitações em andamento](https://transparencia-dn.sesc.com.br/transparencia/dados/dados_abertos/216/dicionario) e [API oficial Sesc DN](https://transparencia-dn.sesc.com.br/transparencia/dados/api/216).
- [Dados abertos de licitações Recife](https://dados.recife.pe.gov.br/pt_BR/dataset/licitacoes).

## Configuração e comportamento

`SENAC_ENABLED`, `SESC_ENABLED` e `RECIFE_ENABLED` aceitam `true`/`false`, com padrão `true`. `SYNC_ENABLED=false` desativa todas as coletas; `WORKER_ENABLED=false` impede execução automática. Os exemplos de ambiente incluem as novas flags.

Cada regional e Recife possuem uma tarefa `sync:portal-N`, sem aplicar os códigos de modalidade do PNCP/Compras.gov. As tarefas existentes conservam seus nomes e cursores. `SYNC_MAX_PAGES` limita cada execução; páginas restantes continuam no próximo ciclo, usando o mecanismo já existente.

Essas APIs retornam um **snapshot de processos em andamento**, sem filtro de publicação por período. `SYNC_LOOKBACK_DAYS` continua sendo usado nas fontes federais; não restringe os snapshots. Assim, processos ainda em andamento com abertura anterior ao período também são coletados. A atualização depende da publicação do fornecedor (Recife informa periodicidade semanal).

O Senac aceita somente situação `Em processo`; o Sesc, `EM ANDAMENTO`; Recife usa o recurso de licitações em andamento, excluindo o recurso de concluídas. Registros sem identificação, objeto, órgão ou data de abertura válida são descartados. Alguns registros do Sesc SE não informam abertura e, portanto, não são importados. Datas brasileiras aceitam dia/mês com um ou dois dígitos e são interpretadas em UTC−3. Quando o Sesc informa somente o dia, o horário é armazenado como meia-noite local, sem afirmar um horário de sessão.

Identificadores possuem namespace de fonte/regional. Recife usa órgão, comissão, ano e número do processo, pois `_id` é um índice do CSV que pode mudar na recarga. Os registros continuam sujeitos à deduplicação existente por assinatura.

Os links seguem a política de `RELATORIOS-E-FONTES.md`: apenas URLs informadas nos registros/documentos, com validação HTTP/HTTPS e sem credenciais. Caminhos internos relativos do Senac não são convertidos em URLs presumidas. Na ausência de endereço, a interface informa que o link oficial não está disponível. As APIs Sesc/Recife frequentemente não retornam um link individual.

Como no fluxo anterior, a ausência de um processo no próximo snapshot não altera automaticamente o status de registros já persistidos. A integração não fornece histórico de situação dos processos.

## Fontes que continuam pendentes

45 portais ainda não têm conector validado. A página conserva o status pendente e apresenta documentação/impedimentos quando encontrados. A pesquisa não implica que esses portais não possuam API.

A verificação das páginas oficiais dos 45 portais e seus resultados está registrada em `FONTES-PENDENTES.json`. São observações de acesso neste ambiente, sem concluir que um portal não tenha API por não encontrá-la na página inicial.

- Petronect: [API Store oficial](https://minhapetronect.com.br/descricao_apistore), dependente das condições de acesso do fornecedor.
- TCE-CE: [especificação SIM](https://api-dados-abertos.tce.ce.gov.br/sim/), com autenticação HTTP Basic declarada e restrição de IPs no Brasil. Não foi registrado um conector sem validar acesso aos dados.
- Minas Gerais: [dataset oficial de licitações](https://www.dados.mg.gov.br/dataset/portal_licitacoes_mg); consultas CKAN/download retornaram HTTP 403 neste ambiente.
- RS/PROCERGS: consulta JSON identificada no JavaScript oficial (`/editais/lotes/ativos.json`); validação retornou timeout.
- Portal de Compras Públicas: [documentação oficial da busca automatizada](https://apipcp.portaldecompraspublicas.com.br/publico/apidoc/) exige `publicKey` do fornecedor. Nenhuma credencial de exemplo foi usada.

## Validação

Em 09/10/2026, consultas reais da primeira página retornaram sucesso para as 59 fontes registradas. Isso valida o acesso e o formato naquele momento, não a disponibilidade contínua nem a completude de todos os registros. O teste é somente leitura, sem gravar licitações ou enviar alertas.

```sh
npm run test:sources -- 2026-10-07 2026-10-09
npm run test:sources -- 2026-10-07 2026-10-09 senac
npm run test:sources -- 2026-10-07 2026-10-09 sesc
npm run test:sources -- 2026-10-07 2026-10-09 recife
```

Também é possível selecionar o ID do catálogo, por exemplo `portal-81`. O teste limita a quatro consultas concorrentes e termina com erro caso alguma fonte falhe.

`test/publicSources.test.js` cobre formato oficial, estados dos processos, datas brasileiras, IDs estáveis, paginação, cache, erros HTTP, flags e continuidade/reimportação no worker com SQL real em PGlite.
