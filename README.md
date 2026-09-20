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
| `SEED_USER_EMAIL` | E-mail do gestor fictício; padrão `gestor@example.test` |
| `SEED_USER_PASSWORD` | Senha do seed, sem valor padrão, mínimo 12 caracteres |

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

Não há usuário de aplicação criado automaticamente. Abra `/cadastro` e cadastre sua empresa, ou configure a senha de seed e execute `npm.cmd run db:seed` para dados fictícios de desenvolvimento.

### Produção com Neon

Use `.env.production.example` como referência para as variáveis do Railway; ele não é carregado automaticamente. Não copie o `.env` local nem `.local/` para produção.

1. Crie o banco no Neon, preferencialmente na mesma versão principal (17) para manter paridade com o ambiente local.
2. Configure `NODE_ENV=production`, `LOCAL_DATABASE=false`, `DATABASE_URL` com pooling, `DATABASE_DIRECT_URL` direta para o mesmo banco e um novo `SESSION_SECRET`.
3. Use TLS (`sslmode=verify-full`); mantenha `APP_TIMEZONE=America/Fortaleza`. Ajuste `TRUST_PROXY_HOPS` ao proxy confiável do deploy para cookies Secure.
4. Instale com `npm ci --omit=dev` e rode `npm run db:migrate` antes da liberação. O PostgreSQL local não é instalado como dependência de produção.
5. Inicie com `npm start`. Esse comando não inicia banco local nem aplica migrations automaticamente. Use a `PORT` fornecida pelo Railway e `/health/ready` para verificar a conexão.

As migrations e o driver `pg` são os mesmos nos dois ambientes. Não é necessário mudar repositories ou services para apontar para Neon. Dados de desenvolvimento não são transferidos automaticamente. A conexão remota e o deploy ainda precisam ser validados quando as credenciais Neon estiverem disponíveis.

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
| `npm start` | Servidor sem watch |
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

## Railway e próximas etapas

A base aceita `PORT` do ambiente, logs em stdout e encerramento por `SIGTERM`. A preparação completa e o deploy são a etapa 16; nenhum serviço remoto foi provisionado ou publicado. Naquela etapa serão configurados variáveis, conexão Neon, migrations antes da liberação, comando `npm start`, healthcheck, proxy, reinicialização e domínio.

Sequência restante: 3 layout/sidebar/dashboard; 4 perfis; 5 teste isolado PNCP; 6 persistência; 7 matches; 8 dashboard real; 9 fontes; 10 primeiro portal complementar validado; 11 deduplicação; 12 e-mail; 13 cron; 14 admin; 15 testes finais; 16 deploy.

PNCP, scraping, envio de e-mail e cron ainda não estão ativos. As dependências específicas serão instaladas nas respectivas etapas. A documentação de cada integração acompanhará sua implementação, incluindo como adicionar um adaptador e os limites de requisição. APIs públicas terão prioridade; nenhuma proteção de portal será contornada.
