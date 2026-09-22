# Entrega e operação do LicitaMatch

Referência utilizada: critérios das etapas no README.md. Não havia outro documento de requisitos no repositório.

## Fluxos entregues

| Etapas | Resultado |
| --- | --- |
| 1–4 | Cadastro, login, sessões, empresa, equipe, permissões e dashboard |
| 5–6 | Adaptador PNCP com endpoint de consultas, parâmetros oficiais, leitura única da resposta e persistência |
| 7–8 | Cadastro/edição/pausa de interesses; correlação do catálogo; oportunidades com busca, score, paginação e situação; dashboard por empresa |
| 9–11 | Catálogo de fontes, adaptador Compras.gov.br, deduplicação por código e assinatura persistida entre importações |
| 12 | Transporte SMTP com TLS, preferência individual, fila durável, tentativas de reenvio e escape de HTML |
| 13 | Worker iniciado pelo servidor, agenda e paginação persistidas, exclusão mútua PostgreSQL, recuperação após falhas |
| 14 | Painel global de empresas e página de operação com fontes, execuções e fila de alertas |
| 15 | Testes automatizados de autenticação, isolamento, rotas, coleta, correlação, paginação, alertas, migrations e inicialização |
| 16 | Configuração Railway e migrations prontas; publicação remota ainda não realizada nesta entrega |

## Uso

1. Execute `npm.cmd run dev` e abra `http://localhost:3000`.
2. Cadastre a empresa ou entre com um acesso existente.
3. Em **Interesses**, informe título e palavras-chave separadas por vírgulas. Gestores e administradores podem editar e pausar; usuários comuns podem consultar.
4. Em **Oportunidades**, filtre por texto, situação ou score. O gestor pode marcar como revisada, aceita ou recusada. Alterar palavras-chave recalcula o score no próximo ciclo, preservando a situação escolhida. Interesses pausados e score zero deixam de aparecer.
5. Em **Minha conta**, escolha se deseja receber alertas. A preferência começa desativada.
6. O administrador acompanha **Admin → Operação e fontes** e pode antecipar a próxima coleta. O botão agenda o trabalho; não mantém a requisição HTTP esperando pelas fontes.

## Configuração

Os arquivos `.env.example` e `.env.production.example` incluem todas as opções novas. As credenciais reais ficam no ambiente.

| Variável | Padrão e significado |
| --- | --- |
| `WORKER_ENABLED` | `true`; executa ciclos a cada 15 segundos enquanto o servidor está ativo |
| `SYNC_ENABLED` | `true`; habilita a coleta PNCP |
| `COMPRASNET_ENABLED` | `false`; habilita a fonte complementar junto de `SYNC_ENABLED=true` |
| `SYNC_INTERVAL_MINUTES` | `60`; intervalo entre varreduras por modalidade |
| `SYNC_LOOKBACK_DAYS` | `2`; janela inicial e sobreposição entre coletas concluídas |
| `SYNC_MAX_PAGES` | `5`; páginas por modalidade por ciclo; continua em um minuto quando há mais páginas |
| `PNCP_MODALIDADES` | `4,6,7,8,9,12`; códigos usados no PNCP |
| `COMPRASNET_MODALIDADES` | `3,5,6,7`; códigos do Compras.gov.br, diferentes dos códigos PNCP |
| `EMAIL_ENABLED` | `false`; quando ativado exige remetente e credenciais SMTP |
| `EMAIL_FROM`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` | Obrigatórios para envio real |
| `SMTP_PORT` | `587` com STARTTLS obrigatório; `465` com TLS desde a conexão |
| `ALERT_MIN_SCORE` | `70`; correlação mínima para alertas |

O worker usa `DATABASE_DIRECT_URL` quando informada. Seus locks são de sessão: uma URL com transaction pooling não serve para esse processo. No Neon, a aplicação pode usar a URL `-pooler`, mas o worker exige a conexão direta do mesmo banco. Outros provedores com transaction pooling também precisam fornecer uma URL direta. `WORKER_ENABLED=false` permite subir somente a aplicação web.

A migration `005_operations.sql` adiciona preferências, índices, assinatura de deduplicação e as tabelas `tarefas` e `alertas`. A migration `006_whatsapp_alerts.sql` acrescenta preferências de WhatsApp e controle por canal; consulte [WHATSAPP.md](WHATSAPP.md). São **seis migrations e nove tabelas verificadas**. As migrations anteriores não foram alteradas. Dados locais existentes são preservados.

Cada fonte recebe requisições sequenciais, páginas de 50 registros e timeout de 30 segundos. Erros de uma modalidade não interrompem as demais. A página pendente fica no banco; falhas repetidas retomam o mesmo ponto. A coleta abrange somente as modalidades configuradas e a janela consultada, não todo o histórico nacional.

## Validação

```sh
npm.cmd test
npm.cmd run test:postgres
npm.cmd run test:sources
```

O teste PostgreSQL cria e remove exclusivamente um banco temporário. Ele verifica migrations concorrentes e o bloqueio do worker entre conexões, além de autenticação e isolamento. Os testes de e-mail usam transporte simulado e não enviam mensagens reais.

Resultado da revisão: **68 testes automatizados aprovados**, incluindo os alertas de WhatsApp, e teste com PostgreSQL real aprovado. A aplicação da migration confirmou as nove tabelas e seis migrations no banco local, sem remoção dos dados existentes.

`test:sources` é somente leitura e consulta as APIs públicas. Na verificação desta entrega, o Compras.gov.br respondeu com JSON válido e zero registros no período consultado; o PNCP excedeu o timeout. Portanto, a integração PNCP foi verificada com respostas controladas de contrato, mas não homologada com resposta real nesta rede. Uma resposta vazia do Compras.gov.br também não prova importação real de um edital. O comando deve ser repetido no ambiente de produção.

## Limitações e pendências externas

- A publicação no Railway, domínio e configuração de credenciais de produção não foram executadas.
- SMTP foi implementado, mas entrega real exige credenciais, remetente válido e validação com o provedor.
- Alertas têm unicidade por match/usuário e até cinco tentativas, espaçadas por 15 minutos. Se o processo cair após o provedor aceitar a mensagem e antes de registrar o envio, pode haver reenvio. SMTP não oferece garantia transacional de entrega única.
- A deduplicação por assinatura aplica-se às novas importações. Registros históricos sem assinatura são preservados; o código externo continua impedindo repetição da mesma contratação identificada.
- O campo de data exibido pode ser a publicação quando a fonte não informa abertura. A interface o identifica como data informada pela fonte.
- O processamento usa um worker por vez e percorre o catálogo em lotes. Bases grandes exigem medição de carga e evolução para processamento incremental; não houve teste de carga de produção.

## Referências dos adaptadores

- [Manuais oficiais do PNCP](https://www.gov.br/pncp/pt-br/pncp/manuais).
- [Manual da API Compras.gov.br, módulo de contratações](https://www.gov.br/compras/pt-br/acesso-a-informacao/manuais/manual-dados-abertos/manual-api-compras.pdf).
- [Transporte SMTP do Nodemailer](https://nodemailer.com/smtp).
