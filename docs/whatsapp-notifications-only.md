# WhatsApp: somente notificações

Implementação preparada, sem ativação. `WHATSAPP_ENABLED=false` e
`WHATSAPP_PRODUCTION_READY=false` permanecem obrigatoriamente desligados nesta etapa.
Atendimento, bot, menus e saídas humanas não possuem fluxo ativo. As flags
`WHATSAPP_BOT_ENABLED`, `WHATSAPP_BOT_OUTBOUND_ENABLED` e
`WHATSAPP_HUMAN_OUTBOUND_ENABLED` aceitam exclusivamente `false`.
Código e migrations anteriores preservados; a mensagem WELCOME permanece como
constante legada, sem uso no webhook. Não há central de atendimento neste repositório.

## Preparação para futura ativação (não executar nesta etapa)

1. Revisar/aplicar a migration aditiva `022_whatsapp_notifications.sql` pelo processo
   habitual, somente após autorização de publicação. Não altera flags nem envia mensagens.
2. Obter aprovação Meta do texto do template e configurar o ContentSid HX correspondente:

   LicitaMatch — nova oportunidade de licitação
   Objeto: {{1}}
   Órgão: {{2}}
   Compatibilidade: {{3}}%
   Consulte o edital: {{4}}

   O código não solicita nem verifica remotamente aprovação: o responsável deve
   conferir aprovação, categoria, idioma e correspondência exata das quatro variáveis.
3. Configurar credenciais Twilio, remetente aprovado, modo production, ContentSid,
   URL pública HTTPS `/api/whatsapp/webhook` e `WHATSAPP_STATUS_CALLBACK_URL`
   terminando em `/api/whatsapp/status`. Usar POST form assinado. Esses endpoints
   não dependem de sessão, Central de Atendimento ou habilitação de saídas.
4. Definir `WHATSAPP_DAILY_LIMIT` (padrão 10; zero bloqueia reservas) e, se conhecido,
   `WHATSAPP_ESTIMATED_UNIT_COST_BRL`. É uma estimativa por tentativa reservada,
   não uma conciliação de cobrança; custo ausente fica desconhecido.
5. Somente após autorização futura, habilitar envios e readiness. A primeira execução
   de produção grava marco persistente. Match e licitação precisam ser posteriores
   tanto ao marco global quanto ao marco do usuário. Nunca limpar reservas para reenvio.

## Interrupção e consentimento

`WHATSAPP_ENABLED=false` bloqueia a saída; mudança de ambiente exige reinício.
Para suspensão operacional imediata, sem reinício: `UPDATE whatsapp_controle SET
suspenso=true WHERE id=true`. Cada reserva e o instante anterior à chamada externa
consultam essa chave. Uma chamada já iniciada no provedor não pode ser desfeita.
Para retomar, definir suspenso=false; não limpar histórico ou marcos.

STOP, SAIR, PARAR, CANCELAR, CANCELAR NOTIFICAÇÕES e `OptOutType=STOP` em requisição
assinada revogam consentimento para todos os usuários com aquele número,
inclusive em contas sem Premium e com os envios/webhook de entrada desligados.
START nunca concede consentimento; nova adesão explícita é feita na conta.
A configuração de cancelamento pelo painel também continua disponível após downgrade.
O webhook sempre devolve TwiML vazio. Desabilitar respostas automáticas também na
configuração da Twilio, se houver regras externas à aplicação.

Reservas serializam por usuário, limitam tentativas numa janela móvel de 24 horas e
bloqueiam o mesmo usuário/licitação mesmo após troca de número. A restrição original
empresa/licitação/número permanece. Falhas e incertezas nunca são reenviadas automaticamente.
O teste Sandbox legado permanece isolado e exige janela ativa para texto livre;
produção envia somente ContentSid, sem body. Não executar o teste Sandbox nesta etapa.

## Observabilidade

Administração → Operação apresenta contagens, custos estimados e últimas 100 reservas.
Histórico completo permanece nas tabelas existentes. Aceitação Twilio não significa
entrega. Eventos assinados de entrega/leitura/falha ficam em `whatsapp_status_eventos`,
deduplicados por SID/estado e preservados mesmo quando chegam antes de persistir o SID.
Eventos atrasados não apagam confirmações anteriores. SID desconhecido não altera reserva.
Dados obrigatórios ou links ausentes bloqueiam envio com código fixo nos logs, sem
conteúdo ou telefone. Ausência de SID/timeout mantém estado incerto e reserva persistente.

Referência do contrato do provedor: [Messages resource da Twilio](https://www.twilio.com/docs/messaging/api/message-resource)
e [webhooks de mensagens](https://www.twilio.com/docs/messaging/guides/webhook-request).

## Arquivos desta entrega

- Configuração: `.env.example`, `src/config/env.js`.
- Notificações e provedor: `src/services/whatsappAlertsService.js`, `src/services/twilioWhatsAppService.js`.
- Webhook/callbacks: `src/routes/whatsappRoutes.js`.
- Administração: `src/routes/accountRoutes.js`, `src/services/operationsService.js`, `src/views/account/operations.ejs`.
- Consentimento na conta: `src/routes/opportunityRoutes.js`, `src/views/account/home.ejs`.
- Schema aditivo: `migrations/022_whatsapp_notifications.sql` (somente arquivo; não aplicado em produção).
- Testes: `test/whatsapp.test.js`, `test/whatsappNotifications.test.js`, `test/admin.test.js`, `test/operations.test.js`, `test/regionalRule.test.js`.
- Documentação: este arquivo, `docs/WHATSAPP.md`, `docs/whatsapp-automatic-activation.md`.

As migrations anteriores não foram alteradas. Os testes históricos que esperavam
boas-vindas agora exigem TwiML vazio; o teste de múltiplos interesses usa uma
licitação posterior à reabilitação. A cobertura histórica foi mantida.

## Validação desta entrega

Comando final: `node --test --test-concurrency=2 --test-reporter=tap test/*.test.js`.
Resultado: **178 testes, 178 aprovados, zero falhas, zero ignorados** (170,2 segundos).
Foram preservados os 173 testes executáveis existentes e acrescentados cinco novos.
As 228 verificações citadas na solicitação não correspondem ao total reportado
pela suíte disponível neste checkout; não foram removidos testes para ajustar a contagem.
A primeira execução restrita encontrou EPERM em subprocessos e HTTP local;
a validação final ocorreu com essa restrição liberada, com PGlite e provedores simulados.
`git diff --check` também passou. Nenhum deploy, migration em produção,
alteração no Railway ou envio real foi realizado.
