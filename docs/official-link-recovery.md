# Importação e recuperação de links oficiais

A extração compartilhada aceita apenas HTTP/HTTPS absoluto, sem credenciais, espaços internos ou barras invertidas, com até 4096 caracteres. Páginas iniciais genéricas são descartadas. Editais explícitos e documentos classificados como edital têm prioridade sobre páginas de contratação/processo. Anexos sem identificação segura não são promovidos a edital. O nome de um arquivo relativo nunca é concatenado a um domínio presumido.

Na importação PNCP, oportunidades sem URL recebem consulta complementar de documentos e, se necessário, de detalhes. Usam-se CNPJ, ano e sequencial reais do payload ou do número de controle PNCP, validando a consistência quando ambos existem. Nenhuma URL pública é construída a partir desses identificadores: somente os endpoints documentados da API são montados; os links salvos vêm das respostas. Falhas mantêm a oportunidade importável e produzem contadores.

## Prévia administrativa

No ambiente com a conexão correta configurada em `DATABASE_DIRECT_URL` ou `DATABASE_URL`:

```bash
npm run links:recover -- --output /tmp/licitamatch-links-preview.json --limit 50 --max-requests 50
```

Este comando não inicia aplicação, worker, migrations ou serviços de mensagem. A consulta roda em `BEGIN READ ONLY`. O arquivo é criado com permissão 0600 e não sobrescreve arquivo existente. Use outro nome para uma nova prévia.

A seleção prioriza licitações dos matches 39404, 38845, 39406, 39407, 21897 e 22040 da empresa 1 com score ≥ 67. Depois inclui outros registros com pelo menos um campo vazio, sem limitar o conserto de metadados a um plano ou score. Cada linha informa ID, origem, código externo, link proposto, fonte da evidência e validação. O resumo mostra encontrados, rejeitados, ausentes, recuperados (zero na prévia), falhas e número de requisições.

Se um dos campos já contiver link válido, ele preenche a proposta do campo vazio sem chamadas externas. Campos existentes não vazios, mesmo inválidos, são preservados para revisão separada.

Revise o JSON e o token impresso. Somente após aprovação explícita, execute:

```bash
npm run links:recover -- --apply /tmp/licitamatch-links-preview.json --confirm TOKEN_DA_PREVIA
```

A aplicação não consulta APIs. Ela verifica o token do conteúdo e a identificação da conexão, usa uma transação e atualiza somente campos ainda vazios, conferindo ID, origem e código externo. Mudanças concorrentes não são sobrescritas; repetir o mesmo arquivo não duplica registros nem altera campos preenchidos. Alterar a conexão, inclusive suas credenciais, exige gerar outra prévia. Preserve o arquivo de prévia com suas evidências para auditoria.

## Cobertura e limites

- PNCP e Compras.gov.br: recuperação pelo número de controle PNCP canônico. Códigos Compras.gov.br sem esse identificador são reportados como `identificador_nao_suportado`, sem tentar adivinhar correspondências.
- Senac: consulta o snapshot oficial da regional, incluindo processos encerrados, e compara o ID exato.
- Sesc: consulta páginas oficiais da regional e compara ano e número, incluindo encerrados.
- Recife: consulta CKAN pela chave completa (órgão, comissão, ano, número) e confere os valores retornados.
- Fontes não implementadas, registros removidos e links não disponibilizados são reportados sem criar URLs alternativas.
- Por padrão: até 50 requisições, intervalo de 250 ms, timeout de 10 s por requisição, orçamento de 30 s por cliente de recuperação e resposta máxima de 4 MiB. Na importação o orçamento é por página. Redirecionamentos de APIs são recusados; URLs candidatas de documentos não são acessadas.
- O cache é limitado no PNCP e reutiliza snapshots/páginas na recuperação. O limite global de requisições também limita a paginação Sesc. Os limites podem deixar itens sem recuperação nesta execução; não significam que não há documento na fonte.
- `valid` indica aprovação sintática e evidência no registro/API. Não comprova HTTP 200 do arquivo, nem garante sua disponibilidade futura.

Logs da importação usam o evento `official_links.import`. A recuperação usa `official_links.recovery.preview` e `official_links.recovery.applied`. Nenhuma mudança nesta funcionalidade reduz os 67% ou altera elegibilidade, consentimento, histórico de envios ou configuração Twilio. Nenhuma consulta de enriquecimento ocorre no envio de WhatsApp.

Referência oficial dos documentos PNCP: https://pncp.gov.br/manual/pt-br/latest/contratacao/consultar_todos_documentos_de_uma_contratacao.html
