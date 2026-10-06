# Planos e permissões

`empresas.plano` é a fonte do plano contratado. A migration `011_plans.sql` converte `basico` em `start`, define Start como padrão de novos cadastros e restringe os valores a `start`, `pro` e `premium`.

| Recurso | Start | Pro | Premium |
| --- | --- | --- | --- |
| Busca automática e filtros por segmento/interesse | Sim | Sim | Sim |
| Match de compatibilidade e gestão de seus status | Não | Sim | Sim |
| Alertas por e-mail | Não | Sim | Sim |
| Relatório de matches por situação e compatibilidade média | Não | Não | Sim |
| Alertas por WhatsApp | Não | Não | Sim |
| Usuários ativos, incluindo gestores e admins vinculados | 1 | 3 | 10 |

Busca por segmento usa os interesses e palavras-chave já cadastrados, sem calcular ou expor scores: `/busca` e `/api/busca`. No Start, `/oportunidades` também apresenta essa consulta básica. Filtros de score/status e alterações de matches exigem Pro. Relatórios estão em `/relatorios` e `/api/relatorios`.

As verificações ocorrem nas rotas, serviços e seleção das filas automáticas. O plano é relido do banco a cada requisição autenticada. O worker não cria nem envia alertas de um canal não contratado, inclusive alertas pendentes anteriores a uma redução de plano. Histórico e preferências são preservados. As configurações globais dos provedores e critérios existentes de elegibilidade continuam necessários.

O admin altera o plano pelo painel ou por `PATCH /api/admin/empresas/:id/plano`, com corpo `{ "plano": "pro" }`, sessão administrativa e CSRF. O formulário usa `POST /admin/empresas/:id/plano`. O cliente não altera seu próprio plano. Acesso sem direito retorna HTTP 403 com mensagem de upgrade.

Criação e reativação de usuários contam apenas usuários ativos. A verificação e a alteração ocorrem na mesma transação com bloqueio da linha da empresa, compartilhado com a troca de plano, para impedir ultrapassar a cota com requisições simultâneas. Edição de um usuário já ativo não consome uma vaga nova. Downgrade acima da cota retorna HTTP 409: desative os acessos excedentes primeiro.

A migração preserva usuários existentes; empresas legadas já acima da cota não podem criar ou reativar acessos até regularização ou upgrade. Nenhum usuário é desativado automaticamente.

Execute as migrations pelo fluxo existente (`npm run db:migrate`, também executado por `npm start`). Os testes em `test/plans.test.js` verificam a migração, acesso direto por URL/API, isolamento por empresa, troca de plano sem novo login, cotas e filas anteriores ao downgrade. Os cenários antigos de recursos completos usam empresas Premium explicitamente no banco de teste.
