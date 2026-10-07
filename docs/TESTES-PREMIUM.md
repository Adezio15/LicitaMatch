# Planos, Dashboard e teste Premium

## Implantação

Execute `npm run db:migrate` com backup e procedimento habitual de implantação. A migration `012_premium_trials.sql` não atualiza planos existentes: muda somente o default para novos registros. Nenhuma variável de ambiente nova. O envio usa `EMAIL_ENABLED`, remetente e provedor/SMTP atuais. Destinatários administrativos são os usuários ativos com tipo `admin`; mantenha pelo menos um cadastrado. Notificações ficam persistidas em `notificacoes_plano`; falhas permanecem pendentes e são repetidas pelo worker de e-mails ou pelas próximas operações de solicitação/aprovação/contratação. Se o worker estiver desligado, monitore os pendentes e reative-o para retentar. Como em SMTP, uma falha após aceitação e antes do commit pode ocasionar reenvio.

## Estrutura

`empresas`: default `sem_plano`, campos `teste_status`, `teste_solicitado_em`, `teste_aprovado_em`, `teste_inicio`, `teste_fim`, `teste_utilizado_em`, `teste_aprovado_por`. `premium_teste` representa acesso temporário quando não há plano pago. Planos pagos existentes são a assinatura vigente no modelo atual; não havia tabela de cobrança ou gateway.

`testes_premium`: histórico permanente, com empresa e CNPJ únicos, solicitante, datas, administrador, IP e user-agent. `testes_premium_tentativas`: auditoria de novas tentativas. `notificacoes_plano`: fila persistente de mensagens. Não apague histórico para permitir repetição de teste.

`planService.getEffectivePlan` e a função SQL `plano_efetivo` aplicam a mesma precedência: Premium pago, teste válido, Start/Pro pago, sem plano. A sessão recarrega a empresa a cada requisição; workers usam a validade SQL e revalidam antes de enviar. A expiração de acesso independe de job. O status da empresa e do histórico é atualizado quando a empresa utiliza o sistema; a listagem administrativa mostra expiração também antes desse acesso.

`premiumTrialService` controla solicitação, aprovação, recusa, contratação e notificações. Aprovação captura `clock_timestamp()` no banco depois de obter os locks e usa o mesmo instante mais `interval '24 hours'` na empresa e no histórico, na mesma transação. Locks na empresa e no CNPJ, mais unicidade no banco, impedem solicitações concorrentes. Recusa também consome a solicitação única conforme a regra de bloquear empresas que já solicitaram.

## Rotas

- `POST /api/testes-premium` e `/conta/teste-premium`: solicitar; repetição retorna 403 com auditoria e notificação.
- `GET /api/admin/testes-premium`, `GET /api/admin/testes-premium/:id`: histórico e detalhes administrativos.
- `GET /admin/testes-premium`: tabela administrativa.
- `POST /api/admin/testes-premium/:id/aprovar` ou `/recusar` (também `/admin/...`): decisão única por administrador.
- `POST /api/planos/contratar` ou `/conta/contratar`: solicita contato administrativo; não ativa plano. Sem preços/gateway configurados, não se inventam preços nem cobrança.
- `GET /api/oportunidades`, `/api/busca`: para sem plano, somente contagens, bloqueio e mensagem. Filtros de texto são ignorados nesse caso para impedir sondagem do conteúdo protegido.
- `GET /api/oportunidades/:id`: 403 sem plano; com plano, detalhe limitado ao perfil da própria empresa.
- Busca, relatórios, alterações de matches, alertas e limites usam plano efetivo.
- `GET /conta/seguranca`: senha, perfil e link para usuários/permissões existentes.

Todas as mutações exigem sessão e CSRF. Decisões exigem administrador. Contratação exige gestor/admin.

## Teste manual

1. Cadastre empresa nova em `/cadastro`. Confirme `sem_plano` e `nao_solicitado` no banco. Confira que empresas anteriores mantêm seus planos.
2. Configure palavras em `/interesses` correspondentes ao catálogo. Dashboard e oportunidades devem mostrar quantidades. Verifique Network e HTML: não podem conter objeto, órgão ou identificadores do edital.
3. Chame `/api/busca`, `/api/oportunidades` e `/api/oportunidades/1` diretamente: listas resumidas e detalhe 403. Relatórios e alteração de matches também devem negar acesso.
4. Clique em Desbloquear oportunidades. Confira Start, Pro, Premium e solicite teste. Confira status pendente, histórico e e-mail administrativo. Repita via API com CSRF: deve retornar 403, registrar tentativa e enfileirar alerta.
5. Com administrador, abra `/admin/testes-premium`, confira detalhes e aprove. Confira início e fim separados por exatamente 86.400.000 ms, administrador e e-mail ao solicitante. A sessão já aberta deve receber Premium na próxima requisição. Para testar recusa, use outra empresa.
6. Verifique relatórios, matches e configurações Premium. O contador é apenas visual.
7. Para simular expiração **somente em desenvolvimento**, execute, substituindo o ID:

```sql
BEGIN;
UPDATE empresas SET teste_fim = now() - interval '1 second' WHERE id = 123;
UPDATE testes_premium SET fim_em = now() - interval '1 second' WHERE empresa_id = 123;
COMMIT;
```

8. Recarregue: bloqueio imediato, mensagem de término e status expirado. Solicitação repetida, inclusive por outro usuário vinculado à empresa, retorna 403. Confira histórico e auditoria. Não altere o período de aprovação em produção.
9. Com plano pago Pro/Premium, simule teste expirado: o plano pago deve permanecer. Um teste válido sobre Pro deve permitir Premium e voltar para Pro ao expirar.
10. Teste Escolher Start/Pro/Premium como gestor: gera solicitação administrativa, sem conceder acesso. O administrador continua atribuindo planos pelo fluxo existente.

## E-mails

Mensagens em texto pelo transport existente: nova solicitação (dados da empresa, contato, horário, status e caminho administrativo), aprovação (início/término), recusa, tentativa de reutilização (teste anterior, usuário, horário, IP e user-agent) e pedido de contratação. Não há URL pública de aplicação configurada, então o caminho administrativo é relativo. Expiração é informada no Dashboard; não há envio de e-mail de expiração.

## Validação automatizada

`node --test --test-concurrency=1 test/premiumTrials.test.js test/plans.test.js` e `npm test -- --test-concurrency=1`. Os testes HTTP precisam de permissão para abrir porta local.

Inclui verificação de expiração no milissegundo exato, manutenção dos três planos existentes na migration, configuração/edição de interesses sem plano, bloqueios de conteúdo e status via HTTP, CSRF e autorização administrativa, aprovação pelo endpoint real, persistência de auditoria, recusa e repetição de e-mails após indisponibilidade do transporte.

## Arquivos envolvidos

- Banco: `migrations/012_premium_trials.sql`.
- Serviços: `src/services/planService.js`, `premiumTrialService.js`, `opportunityService.js`, `accountService.js`, `operationsService.js`.
- Autenticação e dados da conta: `src/middlewares/auth.js`, `src/repositories/accountRepository.js`, `src/controllers/accountController.js`.
- Rotas e catálogo compartilhado: `src/routes/accountRoutes.js`, `src/routes/opportunityRoutes.js`, `src/app.js`.
- Telas: `src/views/account/home.ejs`, `admin.ejs`, `security.ejs`, `trials.ejs`, `locked.ejs`, `opportunity.ejs`, `message.ejs`.
- Componentes e apresentação: `src/views/partials/nav.ejs`, `plans.ejs`, `src/public/account.css`, `src/public/plans.js`.
- Testes: `test/premiumTrials.test.js`, `test/operations.test.js`.

O projeto mantém Express/EJS, PostgreSQL, autenticação por sessão, papéis usuário/gestor/admin e o transporte de e-mail existente em `emailDiagnostics.js`. A gestão de senha e permissões passou para Segurança; os endpoints anteriores continuam disponíveis. Não havia catálogo de preços nem gateway: os botões de contratação geram contato administrativo e não concedem acesso. O administrador atribui o plano pelo controle existente.

### Destinatário administrativo

Configure `ADMIN_EMAIL` no ambiente do serviço (por exemplo, nas variáveis do Railway) com o endereço administrativo real. Valores inválidos impedem a inicialização; valores vazios usam os administradores ativos cadastrados, preservando o comportamento anterior. A configuração tem prioridade para novas notificações administrativas de solicitação, contratação e tentativa de reutilização. Aprovações/recusas continuam sendo enviadas ao solicitante. Notificações já enfileiradas preservam seu destinatário, e e-mails já aceitos pelo provedor não são reenviados automaticamente.

### Diagnóstico HTTP 403

Os eventos de conclusão registram `path` (sem query string), método, status, `requestId`, `usuarioId`, `empresaId`, `perfil` e plano efetivo. Erros 403 tratados também registram `authorizationReason` com a mensagem da regra. Correlacione os eventos pelo `requestId`. Um bloqueio de recurso por plano é esperado quando o plano efetivo não inclui o recurso; bloqueios de perfil, CSRF ou reutilização de teste têm causas distintas e não devem ser atribuídos automaticamente aos planos. Os logs antigos não continham contexto suficiente para essa identificação.

Relatórios continuam exclusivos do Premium. O botão “Exportar em PDF” abre a impressão do navegador, onde o usuário seleciona “Salvar como PDF”; o documento omite menu, botão e rodapé.
