# LicitaMatch

SaaS para monitoramento de licitações públicas brasileiras. **Etapas 1 e 2: fundação, autenticação, empresas e usuários**. Este repositório foi criado do zero; não havia outros projetos disponíveis no workspace para reaproveitar padrões.

## Requisitos e instalação

- Node.js 24 LTS e npm.
- O desenvolvimento pode usar o PostgreSQL 17 incluído nas dependências de desenvolvimento, sem Docker ou instalação global.
- Em produção, use um banco PostgreSQL/Neon dedicado ao LicitaMatch.

```sh
npm ci
npm run db:local:setup
npm run dev
```

No PowerShell desta máquina, use **`npm.cmd run dev`**: a política bloqueia `npm.ps1`, mas não o executável `.cmd`. Não precisa mudar a política de execução. O comando não abre o navegador sozinho; acesse `http://localhost:3000` quando aparecer “LicitaMatch iniciado”.

O setup local cria/configura `.env`, gera senhas aleatórias, inicia o banco e aplica as migrations. Para usar um banco externo, copie `.env.example` para `.env`, configure `LOCAL_DATABASE=false`, as URLs de conexão e um `SESSION_SECRET` aleatório de pelo menos 48 caracteres. Nenhum segredo deve entrar no Git. Para gerar o segredo:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Para banco externo, execute as migrations explicitamente antes de iniciar:

```sh
npm run db:migrate
npm run dev
```

O servidor verifica o banco antes de iniciar. Acesse `http://localhost:3000`, que abre o login. Em **Cadastre sua empresa**, crie a empresa e o primeiro gestor. Empresa e usuário são gravados na mesma transação; não há empresa órfã caso o e-mail já exista. O dashboard e a sidebar ficam para a etapa 3.

## Ambiente

| Variável | Uso |
| --- | --- |
| `NODE_ENV` | `development`, `test` ou `production` |
| `LOCAL_DATABASE` | `true` ativa o banco gerenciado pelo projeto no `predev`; em produção deve ser `false` |
| `PORT` | Porta HTTP; padrão 3000, escuta em `0.0.0.0` |
| `APP_TIMEZONE` | `America/Fortaleza` |
| `DATABASE_URL` | Conexão PostgreSQL da aplicação |
| `DATABASE_DIRECT_URL` | Conexão direta para migrations; se vazia, usa `DATABASE_URL` |
| `DATABASE_POOL_MAX` | Máximo de conexões por processo; padrão 5 |
| `DATABASE_CONNECT_TIMEOUT_MS` | Timeout de conexão; padrão 10000 ms |
| `LOG_LEVEL` | Nível dos logs JSON; padrão `info` |
| `TRUST_PROXY_HOPS` | Quantidade de proxies confiáveis; padrão 0, ajustar ao ambiente de deploy |
| `SESSION_SECRET` | Segredo aleatório de pelo menos 48 caracteres, igual em todas as instâncias |
| `SEED_USER_ROLE` | No seed de desenvolvimento: `gestor` ou `admin`; em `admin:create`: obrigatoriamente `admin` |
| `SEED_USER_EMAIL` | E-mail obrigatório em `admin:create`; no seed de desenvolvimento há um padrão fictício |
| `SEED_USER_PASSWORD` | Senha obrigatória, sem valor padrão, mínimo 12 caracteres e máximo 72 bytes UTF-8 |
| `SEED_COMPANY_ID` | ID da empresa ativa existente; obrigatório para criar com `admin:create` |

### Neon

Crie um projeto/banco dedicado e copie a connection string no painel. Para a aplicação, pode utilizar o endpoint com pool (`-pooler`); para migrations, configure a conexão direta em `DATABASE_DIRECT_URL`. Use TLS com validação de certificado (`sslmode=verify-full`). Nunca desative a validação de certificados. A configuração de TLS é determinada pela URL, sem sobrepor opções conflitantes no driver.

Referências: [conexões TLS no node-postgres](https://node-postgres.com/features/ssl) e [pooling no Neon](https://neon.com/docs/connect/connection-pooling).

### PostgreSQL local de desenvolvimento

Banco **PostgreSQL 17.10 nativo**, fornecido como dependência de desenvolvimento pelo [embedded-postgres](https://github.com/leinelissen/embedded-postgres), com versão fixada no package-lock. O projeto utiliza os binários `initdb`/`pg_ctl` para inicialização e encerramento limpo. Não é uma substituição em memória do PostgreSQL de produção.

- Host: `127.0.0.1`; porta: `55432`; banco: `licitamatch_dev`.
- Usuário da aplicação: `licitamatch_app`, dono do banco, sem superusuário, criação de bancos ou criação de roles.
- Autenticação SCRAM-SHA-256; senhas aleatórias em `.env` e `.local/postgres/credentials.json`, ambos ignorados pelo Git.
- Dados persistentes: `.local/postgres/data`; logs: `.local/postgres/postgres.log` e `control.log`.
- Somente loopback; não expõe o banco na rede. TLS desabilitado apenas nessa conexão local.
- Datas SQL em UTC; a interface continua usando `America/Fortaleza`.

O `predev` inicia o banco caso necessário e aplica migrations pendentes quando `LOCAL_DATABASE=true`. Encerrar o servidor web **não para o PostgreSQL**; o banco permanece disponível para comandos e novos processos. Para parar, use `npm.cmd run db:local:stop`; para reiniciar, `npm.cmd run db:local:start`. Reiniciar não apaga dados nem redefine senhas. Após reiniciar o computador, `npm.cmd run dev` sobe o banco novamente.

O setup recusa `NODE_ENV=production` e não substitui URLs que apontem para outro banco. Em Windows, resolve automaticamente o alias curto 8.3 para os binários quando há nomes como `Usuário` no caminho, sem mover os arquivos. Se o sistema não fornecer um alias sem acentos, use um checkout em um caminho sem acentos. A pasta do banco não deve ser apagada para resolver erros: contém todos os dados locais.

Não há usuário de aplicação criado automaticamente. Abra `/cadastro` e cadastre sua empresa, ou configure `SEED_USER_ROLE`, `SEED_USER_EMAIL` e `SEED_USER_PASSWORD` e execute `npm.cmd run db:seed` para um usuário fictício em desenvolvimento. Para um acesso local de administrador, use `SEED_USER_ROLE=admin`.

### Produção com Neon

Use `.env.production.example` como referência para as variáveis do Railway; ele não é carregado automaticamente. Não copie o `.env` local nem `.local/` para produção.

1. Crie o banco no Neon, preferencialmente na mesma versão principal (17) para manter paridade com o ambiente local.
2. Configure `NODE_ENV=production`, `LOCAL_DATABASE=false`, `DATABASE_URL` com pooling, `DATABASE_DIRECT_URL` direta para o mesmo banco e um novo `SESSION_SECRET`.
3. Use TLS (`sslmode=verify-full`); mantenha `APP_TIMEZONE=America/Fortaleza`. Ajuste `TRUST_PROXY_HOPS` ao proxy confiável do deploy para cookies Secure.
4. Instale com `npm ci --omit=dev` e rode `npm run db:migrate` antes da liberação. O PostgreSQL local não é instalado como dependência de produção.
5. Inicie com `npm start`: o comando aplica migrations pendentes, verifica o banco e só então inicia o servidor. Use a `PORT` fornecida pelo Railway e `/health/ready` para verificar a conexão.

As migrations e o driver `pg` são os mesmos nos dois ambientes. Não é necessário mudar repositories ou services para apontar para Neon. Dados de desenvolvimento não são transferidos automaticamente. A conexão remota e o deploy ainda precisam ser validados quando as credenciais Neon estiverem disponíveis.

### Deploy no Railway

O `railway.json` configura Railpack, migrations no pre-deploy, `npm start`, healthcheck em `/health/ready` e até três tentativas de reinício em caso de falha. Esses campos seguem a [configuração oficial do Railway](https://docs.railway.com/config-as-code/reference).

O pre-deploy executa `npm run db:migrate && npm run db:check`. O primeiro comando prefere `DATABASE_DIRECT_URL` e usa `DATABASE_URL` quando a URL direta não foi configurada; compara as tabelas e o histórico antes de aplicar somente migrations pendentes, depois valida `SELECT 1`, tabelas e checksums. O segundo confirma o schema pela URL usada pela aplicação e também pela URL direta, quando presente. Uma falha impede a liberação do novo deploy. Não configure esses comandos como Build Command: eles precisam do ambiente de execução e acesso ao banco.

Como garantia quando o pre-deploy não estiver sendo aplicado, `npm start` também executa `npm run db:migrate && npm run db:check && node src/server.js`. O servidor só é iniciado se ambas as etapas terminarem com sucesso. Quando o pre-deploy já aplicou as migrations, a segunda execução consulta o histórico e não reaplica as mesmas migrations. O lock transacional serializa execuções concorrentes. No Railway, mantenha Start Command como `npm start`: um comando manual `node src/server.js` ignora essa sequência. Confira também se o deployment usa o commit esperado da branch `main` e o arquivo `/railway.json`.

As migrations usam um executor próprio em `src/services/migrationService.js`, com o driver `pg`, lock transacional, checksums SHA-256 e histórico em `schema_migrations`. Não há Prisma, Knex ou Sequelize.

| Migration | Tabelas criadas / alteração |
| --- | --- |
| `001_foundation.sql` | Cria `empresas` e `usuarios` |
| `002_auth_sessions.sql` | Cria `sessoes` e adiciona `usuarios.auth_version` |
| `003_pncp_persistence.sql` | Cria `licitacoes_pncp` |
| `004_matches.sql` | Cria `interesses` e `matches` |

O executor cria também `schema_migrations`; portanto, são sete tabelas obrigatórias. Os arquivos atuais adicionam tabelas, coluna, índices, funções e triggers, sem remoção de dados. Migrations registradas com checksum correspondente não são reaplicadas. O log `applied` informa exatamente quais foram confirmadas; `tablesBefore` e `tablesAfter` mostram as tabelas obrigatórias presentes antes e depois. Havendo execução concorrente, outra instância também pode ter criado tabelas entre essas verificações.

Se o histórico disser que uma migration foi aplicada mas sua tabela estiver ausente, o diagnóstico falha: não apague registros do histórico nem recrie tabelas manualmente para contornar o erro. Se uma tabela já existir sem histórico, a migration pode falhar e a transação será revertida, preservando o estado anterior. Nesse caso, compare o schema existente antes de preparar uma correção específica. Um banco novo exige as quatro migrations; um banco parcialmente migrado recebe somente as pendentes.

1. Conecte o repositório e use a raiz do projeto como Root Directory. O projeto não precisa de `npm run build`; remova esse comando caso tenha sido configurado manualmente.
2. Nas Variables do serviço da aplicação, configure as variáveis de `.env.production.example` com valores reais. Os arquivos `.env.*.example` não são carregados pelo deploy. `SESSION_SECRET` precisa ter pelo menos 48 caracteres e não pode ser o texto de exemplo. Gere um valor com `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`.
3. Use `TRUST_PROXY_HOPS=1` para a configuração com um proxy confiável e `LOCAL_DATABASE=false`. Deixe o Railway fornecer `PORT`.
4. Se usar o PostgreSQL do Railway em vez do Neon, configure `DATABASE_URL` com a referência `${{Postgres.DATABASE_URL}}`, ajustando `Postgres` ao nome do serviço. Deixe `DATABASE_DIRECT_URL` ausente nesse caso; as migrations usam `DATABASE_URL`. Não use `localhost` nem a URL do banco local de desenvolvimento.
5. Opcionalmente, configure `RAILPACK_NODE_NPM_INSTALL=npm ci --omit=dev` para instalar somente as dependências de produção. Faça o deploy e confira os logs de build, pre-deploy e inicialização. Após subir, gere um domínio nas configurações de Networking.

O servidor, as migrations e o diagnóstico validam diretamente `process.env`. Com `NODE_ENV=production` ou identificação do Railway (`RAILWAY_ENVIRONMENT_ID`/`RAILWAY_SERVICE_ID`), o carregador não lê `.env`. Em desenvolvimento, o carregamento é explícito antes da validação e usa `override: false`, preservando variáveis já injetadas. Importar o módulo de validação não altera o ambiente.

Durante a investigação do deploy, cada comando emite temporariamente apenas `DATABASE_URL presente: true/false` e `SESSION_SECRET presente: true/false` antes de validar. `true` significa que a chave existe (um valor vazio ainda será rejeitado); nenhum valor é mostrado. Se aparecer `false` no novo deployment, a variável não chegou ao processo: confira o serviço da aplicação dentro de `production`, o vínculo de variáveis compartilhadas com esse serviço e se as alterações pendentes de Variables foram aplicadas em um novo deploy. A [documentação de variáveis do Railway](https://docs.railway.com/variables) explica o escopo por serviço, o vínculo de variáveis compartilhadas e a necessidade de aplicar as alterações. Compare os logs do mesmo deployment e da mesma etapa (pre-deploy ou inicialização).

Se aparecer `INVALID_ENV` em `error.code`, o campo `fields` no log lista as variáveis ausentes ou inválidas sem mostrar seus valores. Erros de conexão como `ECONNREFUSED` ou `ENOTFOUND` exigem conferir o endereço e a disponibilidade do banco. A inicialização valida `SELECT 1`, tabelas e checksums das migrations antes de abrir a porta; `DATABASE_SCHEMA_MISMATCH` indica schema incompleto ou divergente. `/health/ready` continua verificando a conexão após a inicialização.

Para investigar um Crash, execute `npm run db:check` no ambiente do serviço com suas variáveis configuradas. O comando usa apenas consultas de leitura: testa `DATABASE_URL` e, quando presente, `DATABASE_DIRECT_URL`, verifica as sete tabelas e as quatro migrations. Não cria tabelas, não aplica migrations e não lê dados de clientes. A URL direta é opcional; se fornecida, deve ser válida e apontar ao mesmo banco/branch Neon da URL da aplicação. Verifique isso no painel Neon: schemas iguais, por si só, não provam que duas URLs apontam ao mesmo banco.

Os logs de falha incluem `stage` e `error.name`, `error.message`, `error.code`, `error.stack`, com remoção de URLs PostgreSQL, credenciais e valores secretos do ambiente. Não envie o `.env` nem URLs de conexão para suporte; compartilhe apenas o diagnóstico sanitizado. As etapas `environment`, `database_connection`, `database_schema`, `application` e `http_listen` indicam onde a inicialização parou. Não desative a verificação TLS para contornar erros de certificado. O aviso `npm warn config production Use --omit=dev instead` não é a causa de Crash.

Em `INVALID_ENV`, consulte também `issues`: cada item tem apenas `field` e `reason`, sem o valor da variável. `MISSING` significa variável ausente no processo; `EMPTY`, valor vazio; `QUOTED_VALUE`, aspas literais; `COMMAND_INSTEAD_OF_URL`, comando `psql` ou atribuição `DATABASE_URL=` colados no lugar da URL; `SURROUNDING_WHITESPACE`, espaços ou quebras de linha nas extremidades; `UNRESOLVED_REFERENCE`, referência de variável não resolvida; `MALFORMED_URL`, sintaxe inválida; `POSTGRES_PROTOCOL_REQUIRED`, protocolo inválido; `HOST_REQUIRED`, host ausente. Em Variables do Railway, cole somente a URL no valor de `DATABASE_URL`, sem aspas nem comando. `postgresql://` e `postgres://`, incluindo `sslmode=require&channel_binding=require`, são aceitos sem reescrever a credencial ou os parâmetros. A validação anterior já aceitava esses dois protocolos em minúsculas e esses parâmetros; somente a lista `fields` não permite determinar qual regra rejeitou o valor do deploy.

Para `SESSION_SECRET`, `MIN_48_CHARACTERS` indica comprimento insuficiente; `PLACEHOLDER_SECRET` rejeita textos como `SUBSTITUA_POR_...`; `WEAK_SECRET` rejeita espaços ou um único caractere repetido. Use o gerador aleatório indicado acima: comprimento mínimo sozinho não garante entropia.

## Organização

```text
migrations/         SQL versionado
scripts/            Comandos operacionais
src/config/         Ambiente e pool PostgreSQL
src/controllers/    Respostas HTTP
src/middlewares/    Tratamento centralizado de erros
src/routes/         Rotas Express
src/repositories/   Consultas SQL de empresas e usuários
src/services/       Regras e migrations
src/services/sources/ Adaptadores futuros de API/scrapers
src/jobs/           Agendamento futuro
src/utils/          Logs e timezone
src/views/          Templates EJS de login, cadastro e conta
src/public/         CSS responsivo
test/               Testes automatizados
```

Controllers não consultam portais. Repositories concentram SQL parametrizado; services cuidam das regras de negócio. Não há `console.log` na aplicação. Logs JSON vão para stdout, sem URLs de conexão, corpos de requisição, cookies ou mensagens brutas do banco.

## Banco e migrations

`npm run db:migrate` aplica os arquivos SQL em ordem, registra checksum em `schema_migrations` e impede alteração silenciosa de migrations já aplicadas. Usa transação única e advisory lock transacional para serializar executores. Em caso de falha, o lote é revertido. Não há rollback destrutivo automático nem migrations no start do servidor.

A migration inicial cria:

- `empresas`: cadastro, CNPJ único, status, plano e timestamps.
- `usuarios`: vínculo obrigatório com empresa, e-mail globalmente único sem distinção de maiúsculas, hash no formato bcrypt, tipo e status.
- Índices, chaves estrangeiras e triggers de `updated_at`.

O cadastro valida os dígitos verificadores do CNPJ numérico, normaliza o e-mail e gera bcrypt com custo 12. O CNPJ não pode ser alterado pelas telas desta etapa. CNPJ alfanumérico ainda não é aceito. A migration `002_auth_sessions.sql` adiciona `auth_version` ao usuário e cria `sessoes` com expiração `timestamptz`. Não edite `001_foundation.sql` em bancos que já a aplicaram.

As tabelas de perfis, fontes, coletas, licitações, itens, documentos, matches e notificações serão criadas nas etapas correspondentes. As consultas privadas atuais usam a empresa derivada da sessão; um `empresa_id` enviado pelo cliente não altera o escopo. Novos repositories devem manter essa regra. Não há RLS configurado: o isolamento atual é aplicado e testado no backend, não para acessos SQL diretos.

Crie novas migrations em vez de editar as aplicadas. Os caminhos são relativos aos módulos, sem dependência do diretório de execução.

## Timezone

Persistência com `timestamptz` e sessões SQL em UTC. Exibição por `Intl.DateTimeFormat` com `America/Fortaleza`, sem subtrair horas manualmente. `formatDateTime` exige offset em strings; horários sem offset fornecidos pelos portais serão interpretados explicitamente pelos adaptadores nas próximas etapas. Datas civis sem hora não devem ser convertidas implicitamente em instantes UTC.

## Comandos disponíveis

| Comando | Função |
| --- | --- |
| `npm run dev` | Inicia banco local e aplica migrations se habilitado, depois servidor com watch |
| `npm run db:local:setup` | Cria banco persistente, gera credenciais e configura `.env` |
| `npm run db:local:start` | Inicia/reutiliza PostgreSQL local e aplica migrations |
| `npm run db:local:stop` | Para PostgreSQL local sem apagar dados |
| `npm run db:local:status` | Mostra se PostgreSQL local está em execução |
| `npm start` | Migrations pendentes, validação do banco e servidor sem watch |
| `npm run db:migrate` | Aplicar migrations |
| `npm run db:seed` | Empresa Exemplo LTDA e gestor; exige development explícito e senha no ambiente |
| `npm test` | Testes da fundação, autenticação e isolamento, sem conexão externa |
| `npm run test:coverage` | Testes com cobertura nativa |
| `npm run test:postgres` | Integração opt-in contra o PostgreSQL local real |

Os comandos `sync:pncp`, `sync:scrapers`, `sync:all` e `matches` serão adicionados quando suas implementações existirem. O seed usa dados fictícios, nunca envia e-mail e nunca substitui senha ou cadastro existente. Configure `NODE_ENV=development`, `SEED_USER_EMAIL` e `SEED_USER_PASSWORD` antes de executá-lo. Os perfis de exemplo ficam para a etapa 4.

## Autenticação, empresa e equipe

- `/login`: e-mail, senha e lembrar acesso; `/cadastro`: criação da empresa e do gestor.
- `/conta`: dados do acesso e troca de senha mediante senha atual.
- `/empresa`: leitura para usuários autenticados e edição para gestores.
- `/usuarios`: gestores podem criar, listar, editar e desativar usuários da própria empresa.
- `POST /logout`: destrói a sessão no PostgreSQL e limpa o cookie. Não há logout por GET.

O cadastro público sempre cria um `gestor`, empresa ativa e plano básico. `usuario` consulta sua empresa; `gestor` administra a própria empresa e equipe. `admin` é reservado para administração global futura e não pode ser criado ou alterado pelos formulários/API públicos. Nesta etapa até um admin permanece limitado à sua empresa nas rotas de conta. Status/plano da empresa não são editáveis pelo cliente.

Gestores não alteram o próprio cadastro/permissão nessa tela. Alterações de usuários são serializadas por empresa e revalidam o gestor dentro da transação, evitando que dois gestores removam o acesso um do outro simultaneamente. Alterações de cadastro de usuário incrementam `auth_version`, invalidando sessões anteriores. A troca de senha também incrementa essa versão e exige novo login em todos os dispositivos.

### Sessões e proteção

`express-session` usa `connect-pg-simple` com a tabela criada pela migration; não usa MemoryStore. Apenas identificadores, versão de autenticação, expiração e token CSRF ficam na sessão; nenhuma senha ou hash. O ID da sessão é renovado no login/cadastro.

Sem lembrar acesso, o cookie é de sessão do navegador e o servidor limita o acesso a 8 horas. Com lembrar acesso, cookie e acesso duram até 30 dias. Há expiração absoluta: navegação não estende o prazo. O navegador pode restaurar cookies de sessão ao recuperar abas; o limite no servidor continua valendo. A limpeza de registros expirados roda a cada aproximadamente 15 minutos.

Cookies usam `HttpOnly` e `SameSite=Lax`; em produção, também `Secure`, exigindo HTTPS. Configure corretamente `TRUST_PROXY_HOPS` quando o HTTPS terminar num proxy confiável. Usuários inativos, empresas suspensas/inativas e versões de sessão antigas são recusados a cada requisição protegida. Trocar `SESSION_SECRET` invalida cookies existentes.

Todos os POST/PATCH exigem token CSRF associado à sessão, incluindo login e cadastro. Templates usam saída escapada e CSP do Helmet. O login limita falhas por IP a 10 em 15 minutos; cadastro limita a 5 tentativas por hora; há também limite geral. Os contadores de rate limit são locais ao processo: uma implantação com várias réplicas exigirá store compartilhado. As sessões, por sua vez, já são compartilhadas no PostgreSQL.

Senhas novas exigem ao menos 12 caracteres e no máximo 72 bytes UTF-8 para evitar truncamento do bcrypt. Não há senha padrão. Recuperação por e-mail e convite de usuários continuam previstos para uma etapa futura; o usuário já pode trocar sua senha autenticado.

Referências de implementação: [sessões Express](https://expressjs.com/en/resources/middleware/session/), [connect-pg-simple](https://github.com/voxpelli/node-connect-pg-simple) e [bcrypt](https://github.com/kelektiv/node.bcrypt.js).

### API de conta

Use o mesmo cookie retornado por `GET /api/auth/csrf` e envie o token no header `X-CSRF-Token` em operações de escrita. Login/cadastro devolvem um novo token; substitua o anterior. Os formulários EJS fazem esse fluxo por campos ocultos.

| Método e caminho | Uso |
| --- | --- |
| `GET /api/auth/csrf` | Token para a sessão atual |
| `POST /api/auth/register` | Empresa e primeiro gestor |
| `POST /api/auth/login` | `email`, `senha`, `lembrar` booleano opcional |
| `GET /api/auth/me` | Usuário autenticado, sem hash |
| `POST /api/auth/logout` | Encerrar sessão |
| `POST /api/auth/password` | `senha_atual` e nova `senha` |
| `GET /api/empresa` | Empresa da sessão |
| `PATCH /api/empresa` | Dados cadastrais, somente gestor |
| `GET /api/usuarios` | Até 200 usuários da empresa, somente gestor |
| `POST /api/usuarios` | `nome`, `email`, `senha`, `tipo` (`usuario` ou `gestor`) |
| `GET /api/usuarios/:id` | Usuário da empresa, somente gestor |
| `PATCH /api/usuarios/:id` | `nome`, `email`, `tipo`, `ativo` booleano |

Cadastro: `razao_social`, `cnpj`, `email_empresa`, `nome`, `email`, `senha`; opcionais `nome_fantasia`, `telefone`, `cidade`, `estado`. Edição de empresa aceita os campos cadastrais exceto CNPJ; `razao_social` e `email_empresa` são obrigatórios. Campos desconhecidos são rejeitados. API usa 401 para sessão/login inválido, 403 para permissão/CSRF, 404 para usuário fora do escopo ou inexistente, 409 para duplicidade e 422 para validação.

## Verificações e saúde

- `/health/live`: processo HTTP disponível.
- `/health/ready`: verifica conexão com PostgreSQL; retorna 503 se indisponível. Não garante que todas as migrations estejam aplicadas.
- Testes: configuração, timezone, HTTP, SQL, migrations, cadastro transacional, bcrypt, CSRF, sessões persistidas, cookies, expiração, permissões, tentativas de acesso entre empresas, suspensão, desativação, troca de senha e limites de login.

`npm test` utiliza PGlite, sem conexão externa, além de verificar as proteções que impedem provisionamento local em produção. O teste de migrations nessa suíte substitui o advisory lock porque esse ambiente é de processo único. Os testes HTTP usam repositories e o session store reais sobre esse banco.

`npm run test:postgres` requer banco local iniciado. Cria um banco temporário próprio, valida migrations concorrentes com advisory locks reais, usuário sem superpoderes, cadastro, login/logout, isolamento e timezone; remove somente esse banco temporário ao concluir. Não insere dados de teste em `licitamatch_dev`. TLS remoto e o deploy Neon permanecem pendentes. Cookies Secure são testados simulando o proxy HTTPS; não substitui teste do deploy.

## Parte 4: Perfis e regras de acesso

A etapa 4 concentra a camada de perfis e o controle de permissões por tipo de usuário. O objetivo é garantir que cada conta tenha um papel claro dentro da organização e que o acesso siga regras explícitas, sem depender do cliente para segurança.

### Perfis previstos

- `usuario`: consulta dados da própria empresa e do próprio acesso; não pode editar dados cadastrais nem administrar a equipe.
- `gestor`: administra a própria empresa e pode criar ou editar usuários do mesmo escopo; não pode elevar outro usuário a `admin`.
- `admin`: reservado para administração global futura; continua limitado à empresa da sessão nesta etapa e não pode ser criado por cadastro público.

### Regras de implementação

- O middleware de autenticação valida sessão, empresa ativa, `auth_version` e expiração em toda rota protegida.
- O middleware `requireManager` permite apenas `gestor` ou `admin` acessar rotas de empresa e usuários.
- A criação de usuários é fechada para a empresa do gestor atual; a consulta de usuários nunca usa `empresa_id` enviado pelo cliente.
- A alteração de usuários incrementa `auth_version`, invalidando sessões antigas e exigindo novo login em todos os dispositivos.
- O papel `admin` não pode ser inserido pela API pública nem pela tela de cadastro, preservando o uso exclusivo para operação central.

### Critério de aceite

- Usuários comuns só veem o próprio acesso e a empresa em leitura.
- Gestores conseguem gerir a empresa e a equipe da sua organização.
- Administradores ficam visíveis no dashboard, mas sem liberar funções de criação global nesta fase.

## Parte 5: Teste isolado do PNCP

A etapa 5 introduz a base de integração com o Portal Nacional de Contratações Públicas (PNCP). O objetivo é criar um adaptador isolado, com teste automatizado sem depender da internet do ambiente de desenvolvimento, para validar a normalização de dados antes de persistir eventos e licitações reais.

### Regras da integração

- O adaptador é acessível via `src/services/sources/pncpSource.js`.
- A fonte pública do PNCP é consultada de forma controlada, enviando somente parâmetros de paginação e termos opcionais.
- Os dados retornados são normalizados para o formato interno do sistema, com campos mínimos: `id`, `objeto`, `dataAbertura`, `unidadeGestora` e `modalidade`.
- Registros incompletos são descartados antes de entrar na fila de processamento.
- Falhas de rede ou respostas HTTP inválidas geram erro explícito e não mascaram a causa real.

### Teste isolado

O teste automatizado em `test/pncp.test.js` usa um `fetch` simulado em vez de chamar a API pública. Isso mantém o ambiente estável e permite validar o contrato do adaptador em qualquer máquina de desenvolvimento.

### Critério de aceite

- A resposta do PNCP é normalizada corretamente.
- Registros vazios ou incompletos são rejeitados.
- Erros HTTP são propagados com mensagem legível.
- O contrato do adaptador fica pronto para a próxima etapa de persistência e agendamento.

## Parte 6: Persistência dos itens PNCP

A etapa 6 adiciona a camada de persistência para os itens vindos do PNCP. O objetivo é armazenar os registros válidos em banco para que a próxima etapa possa montar a fila de processamento, deduplicar eventos e preparar consultas por data e origem.

### Estrutura persistida

A migration 003 cria a tabela `licitacoes_pncp`, com colunas para:

- `codigo_externo`: identificador único do item no PNCP
- `objeto`: descrição da licitação
- `data_abertura`: timestamp do evento
- `unidade_gestora`: instituição responsável
- `modalidade`: modalidade da contratação
- `origem`: valor fixo `pncp`
- `created_at` e `updated_at`: auditoria padrão do sistema

### Regras de persistência

- Itens vazios ou inválidos não entram no banco.
- Reprocessamento da mesma licitação não duplica registro por `codigo_externo`.
- A consulta de histórico retorna os itens mais recentes primeiro.
- A camada de persistência fica isolada em `src/services/pncpPersistenceService.js` para facilitar testes e extensão futura.

### Critério de aceite

- Um item válido é persistido uma única vez.
- Um item duplicado é ignorado sem erro.
- Um item incompleto é descartado antes de gravar.
- A tabela sente o contrato de origem do PNCP e está pronta para a etapa de processamento posterior.

## Parte 7: Matches e correlação de oportunidades

A etapa 7 cria o mecanismo de matching entre interesses da empresa e licitações importadas do PNCP. O objetivo é relacionar cada oportunidade com as palavras-chave de negócio do cliente e produzir uma pontuação objetiva para priorização.

### Estrutura da etapa

A migration 004 cria duas tabelas:

- `interesses`: conjunto de palavras-chave ou temas de interesse da empresa
- `matches`: correlação entre interesse e licitação com score e status

### Regras de match

- A pontuação é calculada pela proporção de palavras-chave encontradas no texto da licitação.
- O texto considerado inclui `objeto`, `modalidade` e `unidade_gestora`.
- Termos curtos e duplicados são descartados para manter a pontuação estável.
- Repetições de um mesmo match para o mesmo interesse e licitação são ignoradas.

### Critério de aceite

- Uma licitação com palavras-chave relevantes recebe score alto.
- Uma licitação sem relação relevante recebe score baixo ou zero.
- O mesmo par interesse/licitação não pode ser salvo duas vezes.
- A fila de matches fica pronta para a próxima etapa de visualização e priorização.

## Parte 8: Dashboard real

A etapa 8 conecta a conta autenticada ao banco e substitui os valores fixos do painel por métricas reais do cliente: total de oportunidades, interesses ativos, usuários ativos e melhor correlação registrada.

### Estrutura da etapa

O dashboard passa a consultar a empresa da sessão e montar um resumo com:

- total de matches para o escopo da empresa
- número de interesses ativos
- melhor score registrado no período
- lista de oportunidades mais relevantes para exibir no painel

### Regras de implementação

- Os dados do painel são sempre calculados pela empresa da sessão, nunca por parâmertos externos.
- O resumo usa `matches`, `interesses` e `usuarios` para refletir a realidade do cliente.
- A listagem de oportunidades mostra apenas os registros mais relevantes e ordenados por score.
- O template da conta continua acessível e seguro, com o mesmo controle de sessão e CSRF.

### Critério de aceite

- O dashboard apresenta métricas reais do banco para a empresa autenticada.
- A lista de oportunidades reflete os matches existentes e não valores fictícios.
- O painel continua funcionando como a área principal do usuário após login.
- A próxima etapa pode seguir para fontes de dados externas, cron e alertas sem quebrar a conta.

## Parte 9: Catálogo de fontes e integrações

A etapa 9 formaliza o catálogo de fontes de dados do sistema. Em vez de depender de uma integração fixa, o backend passa a apontar para uma registry de adapters que expõem o mesmo contrato: cada fonte recebe um identificador, um nome e um método `fetchLatest()`.

### Estrutura da etapa

A nova camada fica em `src/services/sources/sourceRegistry.js` e permite:

- registrar fontes por identificador (`pncp`, `demo`, `portal_x`)
- listar as fontes ativas para o sistema
- executar uma fonte específica com consulta opcional de página e filtros
- rejeitar chamadas para fontes inexistentes com erro legível

### Regras de implementação

- Toda fonte registrada deve expor `fetchLatest(query)`.
- O catálogo mantém o mesmo padrão de contrato da fonte PNCP e prepara a extensão para portais complementares.
- Fontes desabilitadas podem permanecer registradas sem aparecer na listagem ativa.
- A interface do sistema continua isolada do detalhe do adaptador, sem acoplamento direto a um único portal.

### Critério de aceite

- O sistema consegue listar fontes registradas e ativadas.
- Uma fonte específica pode ser executada dinamicamente.
- A chamada para uma origem inexistente falha com mensagem clara.
- O projeto está pronto para a próxima etapa de validação real de um portal complementar.

## Parte 10: Primeiro portal complementar validado

A etapa 10 introduz a primeira integração complementar à base PNCP. O objetivo é validar um segundo provedor de compras públicas com o mesmo contrato do adaptador: normalização, paginação e rejeição de payloads inválidos.

### Estrutura da etapa

A nova fonte fica em `src/services/sources/comprasnetSource.js` e segue o mesmo padrão do PNCP:

- `normalizeComprasnetItems(payload)` converte o payload do portal em itens internos
- `createComprasnetSource(...)` executa a chamada HTTP e retorna `source`, `count` e `items`
- o contrato do item interno continua consistente com `id`, `objeto`, `dataAbertura`, `unidadeGestora` e `modalidade`

### Regras de implementação

- O portal complementar usa o mesmo modelo interno do PNCP para evitar duplicação de regras de negócio.
- Registros sem código, descrição, data ou órgão são descartados antes do processamento.
- Falhas HTTP e erros de rede são propagados com mensagem clara para diagnóstico.
- A fonte pode ser registrada no catálogo de fontes sem criar acoplamento ao restante da aplicação.

### Critério de aceite

- O payload do portal complementar é normalizado corretamente.
- Dados incompletos são rejeitados antes de entrar no processamento.
- Erros de resposta são explicitados e não mascarados.
- O projeto já está preparado para a etapa de deduplicação e consolidação entre portais distintos.

## Parte 11: Deduplicação de itens entre fontes

A etapa 11 cria a camada de deduplicação para consolidar registros vindos de múltiplos portais. O objetivo é evitar que a mesma contratação apareça repetida quando o mesmo item chega por PNCP, ComprasNet ou outras integrações.

### Estrutura da etapa

A nova lógica fica em `src/services/deduplicationService.js` e opera em um conjunto de itens já normalizados. Ela gera uma assinatura estável para cada registro e elimina duplicatas sem perder a principal fonte de origem.

### Regras de implementação

- Se o item possui `id`, a assinatura usa esse identificador como prioridade.
- Quando o identificador é diferente mas os campos fundamentais são equivalentes, a assinatura por texto normalizado faz a correlação.
- O comparador considera `objeto`, `data`, `unidade gestora` e `modalidade` para criar a chave estável.
- Itens repetidos são preservados apenas uma vez na lista final.

### Critério de aceite

- Itens duplicados entre fontes entram apenas uma vez na fila final.
- Itens distintos continuam sobrevivendo como registros diferentes.
- O processamento posterior não precisa lidar com cópias repetidas.
- A base fica pronta para a etapa de e-mail e alertas.

## Parte 12: E-mail e alertas

A etapa 12 formaliza o serviço de e-mail do sistema para notificar os usuários quando há oportunidades relevantes com pontuação alta no painel de matches.

### Estrutura da etapa

A camada principal fica em `src/services/emailService.js` e expõe um serviço com transporte injetável:

- `createEmailService({ transport, from })`
- `sendMatchAlert({ to, customer, item, score, interestName })`

Esse desenho permite conectar um provedor real de SMTP ou uma fila/adapter em produção sem acoplar o restante da aplicação aos detalhes do provedor escolhido.

### Regras da integração

- O serviço valida destinatário, subject e score antes de disparar o e-mail.
- O texto e o HTML do alerta incluem o nome do interesse, a pontuação, o objeto e a unidade gestora.
- A ausência de transporte configurado é tratada como erro explícito.
- O alerta é útil para a próxima etapa de cronologia e disparo automatizado.

### Critério de aceite

- Um e-mail de oportunidade com payload válido é enviado corretamente.
- E-mails inválidos são rejeitados antes do envio.
- Sem transport configurado, a operação falha com mensagem legível.
- O sistema fica pronto para a etapa 13 de orquestração e cron.

## Parte 13: Cron e execução programada

A etapa 13 cria a orquestração mínima de jobs recorrentes para sincronizar fontes externas e acionar a fila de alertas em intervalos regulares.

### Estrutura da etapa

A camada fica em `src/services/cronService.js` e oferece:

- `register(name, job)` para registrar um job com intervalo e próxima execução
- `listJobs()` para inspecionar a fila de jobs ativos
- `runDue()` para executar somente os jobs vencidos no momento atual

### Regras de implementação

- Cada job precisa de `run()` e `intervalMs > 0`.
- Quando um job dispara, a próxima execução é agendada em `now + intervalMs`.
- Jobs que ainda não venceram ficam pausados até o limite temporal.
- O serviço é unidirecional e não depende de um gerenciador de processos externo; ele organiza a recorrência do sistema de forma explícita.

### Critério de aceite

- Jobs vencidos são executados exatamente uma vez por ciclo.
- Jobs futuros não executam antes do horário definido.
- O serviço fornece observabilidade simples para manutenção e testes.
- A base fica pronta para a etapa 14 de administração e supervisão global.

## Railway e próximas etapas

A base aceita `PORT` do ambiente, logs em stdout e encerramento por `SIGTERM`. O `railway.json` configura migrations antes da liberação, comando `npm start`, healthcheck e reinicialização. Nenhum serviço remoto foi provisionado ou publicado nesta preparação; ainda é necessário configurar variáveis, banco, proxy e domínio e validar o deploy real conforme as instruções acima.

Sequência restante: 3 layout/sidebar/dashboard; 4 perfis; 5 teste isolado PNCP; 6 persistência; 7 matches; 8 dashboard real; 9 fontes; 10 primeiro portal complementar validado; 11 deduplicação; 12 e-mail; 13 cron; 14 admin; 15 testes finais; 16 deploy.

A etapa 8 foi concluída com o painel agora alimentado por dados reais da empresa autenticada.
A etapa 9 acrescenta o catálogo de fontes e prepara a extensão para novos portais sem acoplar a aplicação a um único provedor.

PNCP, scraping, envio de e-mail e cron ainda não estão ativos. As dependências específicas serão instaladas nas respectivas etapas. A documentação de cada integração acompanhará sua implementação, incluindo como adicionar um adaptador e os limites de requisição. APIs públicas terão prioridade; nenhuma proteção de portal será contornada.

## Primeiro administrador (produção / Railway)

`npm run admin:create` é um comando operacional independente do seed de desenvolvimento.
Usa bcrypt custo 12 (a mesma função de hash da autenticação), valida senha com
12 caracteres no mínimo e 72 bytes UTF-8 no máximo, e nunca registra senha, hash,
URL de conexão ou erros brutos do PostgreSQL. Não executa migrations nem apaga dados.

O esquema das migrations 001 e 002 exige `usuarios.empresa_id`, `nome`, `email`,
`senha_hash`, `tipo` e inclui `ativo` e `auth_version`. O perfil é `tipo='admin'`;
não existe coluna `role`. O índice único usa `lower(trim(email))`. O login exige
usuário e empresa ativos. Portanto, para um novo administrador, selecione uma
empresa real existente por `SEED_COMPANY_ID`. Se o banco estiver vazio, cadastre
primeiro a empresa pelo fluxo público `/cadastro` (que cria um gestor) e use um
**outro e-mail** para o administrador. O script não cria empresa fictícia nem
promove contas comuns. Para consultar IDs no editor SQL do Neon:

```sql
SELECT id, razao_social, status FROM empresas ORDER BY id;
```

Após publicar esta versão e aplicar as migrations pelo fluxo normal de deploy,
configure nas Variables do serviço Railway:

- `SEED_USER_EMAIL`: e-mail do administrador.
- `SEED_USER_PASSWORD`: senha forte, sem aspas adicionais; informe somente nas variáveis, nunca no comando.
- `SEED_USER_ROLE`: `admin` (obrigatório).
- `SEED_COMPANY_ID`: ID da empresa ativa (obrigatório apenas para criar).
- `DATABASE_DIRECT_URL`: URL direta do Neon, preservando os parâmetros TLS fornecidos pelo Neon.
  Se ausente ou vazia, usa `DATABASE_URL`. Uma URL direta inválida ou inacessível causa
  erro; não troca silenciosamente de banco. O comando não exige `SESSION_SECRET`.

Aplique as variáveis ao deployment. Abra o shell do serviço correto usando o comando
“Copy SSH Command” do Railway, ou pela CLI autenticada:

```sh
railway ssh --project SEU_PROJETO --service SEU_SERVICO --environment production
npm run admin:create
```

O segundo comando é executado dentro do container. Referência: [Railway SSH](https://docs.railway.com/cli/ssh).
Não adicione o cadastro ao Start Command ou ao pre-deploy: execute pontualmente.
Se já houver administrador com esse e-mail, o comando preserva a senha e não duplica.
Para trocar a senha, atualize `SEED_USER_PASSWORD` nas Variables, aplique ao deployment,
abra uma nova conexão SSH e execute:

```sh
npm run admin:create -- --update-password
```

Essa opção exige administrador existente, preserva empresa/perfil/status e incrementa
`auth_version`, invalidando suas sessões anteriores. E-mail de conta não administradora,
empresa divergente ou conta/empresa inativa causam recusa sem alteração. A operação usa
transação, consultas parametrizadas, lock por e-mail e o índice único do banco para
impedir duplicatas. Remova `SEED_USER_PASSWORD` das Variables depois de concluir e
aplique a remoção. A conta permanece cadastrada.
