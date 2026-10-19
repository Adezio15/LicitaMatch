> Política vigente: [WhatsApp somente notificações](whatsapp-notifications-only.md).
> As regras abaixo são históricas; respostas de boas-vindas foram desabilitadas,
> produção usa quatro variáveis e licitações antigas também são excluídas.

# WhatsApp oficial via Twilio

O adaptador usa o SDK oficial Twilio. E-mail, autenticação e regras comerciais permanecem independentes. A política existente autoriza somente responsáveis (gestor/admin) de empresas ativas com plano efetivo Premium. O gate fica em src/services/whatsappAlertsService.js e é compartilhado com o webhook, permitindo ajustar os planos futuramente sem mudar o adaptador.

## Configuração inicial no Railway

Cadastre as variáveis no serviço da aplicação, sem versionar credenciais:

| Variável | Valor inicial |
| --- | --- |
| TWILIO_ACCOUNT_SID | SID AC... da conta/subconta que recebe o webhook |
| TWILIO_AUTH_TOKEN | Auth Token dessa conta/subconta; nunca API Key secret |
| TWILIO_WHATSAPP_FROM | whatsapp:+NUMERO do Sandbox mostrado na Twilio |
| WHATSAPP_ENABLED | false; controla somente alertas automáticos |
| WHATSAPP_WEBHOOK_ENABLED | false por padrão; true para testar recebimento e boas-vindas |
| WHATSAPP_MODE | sandbox |
| WHATSAPP_WEBHOOK_URL | https://licitamatch.online/api/whatsapp/webhook |
| WHATSAPP_SANDBOX_NUMBERS | Números permitidos, separados por vírgulas, como +5584999999999 |
| WHATSAPP_PRODUCTION_READY | false |
| TWILIO_WHATSAPP_CONTENT_SID | Omitir inicialmente; HX... do conteúdo aprovado na produção |
| WORKER_ENABLED | true para processar alertas; mantém o comportamento existente |

Não altere EMAIL_ENABLED nem as credenciais de e-mail para testar WhatsApp. As antigas variáveis WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_API_VERSION, WHATSAPP_TEMPLATE_NAME e WHATSAPP_TEMPLATE_LANGUAGE não são utilizadas pelo novo adaptador. Mesmo com credenciais completas, WHATSAPP_ENABLED e WHATSAPP_WEBHOOK_ENABLED permanecem false quando omitidas. Cada flag é independente; ativar qualquer uma exige as três credenciais Twilio.

A migration 017_twilio_whatsapp.sql deve ser aplicada pelo processo habitual (npm run db:migrate) antes de ativar a integração. Nenhuma migration foi aplicada no banco Railway por esta implementação.

## Webhook e proxy

Em Twilio Console → Sandbox settings → When a message comes in, configure:

https://licitamatch.online/api/whatsapp/webhook

Método HTTP POST, sem query string. Se precisar de parâmetros na URL, configure exatamente a mesma URL, incluindo codificação e query, em WHATSAPP_WEBHOOK_URL.

O endpoint aceita application/x-www-form-urlencoded. O SDK valida X-Twilio-Signature usando todos os parâmetros e a URL pública fixa, antes de consultar o banco. Não deriva essa URL de Host, X-Forwarded-Host ou do protocolo interno do Railway. TRUST_PROXY_HOPS mantém sua função existente para sessões/rate limiting; ajuste conforme a topologia real do serviço, sem necessidade de usá-lo para validar a assinatura. AccountSid e To também são conferidos. O webhook é registrado antes das sessões e não exige login nem CSRF.

Com WHATSAPP_WEBHOOK_ENABLED=false, requisições válidas recebem HTTP 200 com TwiML vazio, sem consulta de elegibilidade nem registro de mensagem. Com true, o webhook pode registrar e responder mesmo com WHATSAPP_ENABLED=false. Token ausente retorna 503; assinatura inválida retorna 403; formato diferente de formulário retorna 415. Falhas SQL retornam 503 com log sanitizado.

## Teste do Sandbox

1. Entre no Sandbox pelo código join mostrado na Twilio.
2. Use um responsável ativo de empresa autorizada no LicitaMatch. Em Minha conta → Alertas pelo WhatsApp, informe o celular, confirme o consentimento e salve a preferência. Não use automaticamente o telefone cadastral da empresa.
3. Inclua esse número em WHATSAPP_SANDBOX_NUMBERS.
4. Depois de aplicar a migration e configurar o webhook, ative somente WHATSAPP_WEBHOOK_ENABLED=true. Mantenha WHATSAPP_ENABLED=false, WHATSAPP_MODE=sandbox e WHATSAPP_PRODUCTION_READY=false.
5. Envie uma mensagem ao Sandbox. A resposta esperada é: “Olá! Bem-vindo ao LicitaMatch. Em breve você receberá informações sobre oportunidades de licitação.”
6. Confira a resposta e o registro em whatsapp_inbound. Nenhum alerta automático de licitação será enviado com WHATSAPP_ENABLED=false, mesmo que exista oportunidade elegível e janela ativa. Não é necessário alterar WORKER_ENABLED ou configurações de e-mail.
7. Ao concluir, volte WHATSAPP_WEBHOOK_ENABLED=false; mantenha WHATSAPP_ENABLED=false.

A participação ativa é gerenciada pela Twilio, não por uma lista local de sessões: a aplicação exige chamada assinada, AccountSid e To corretos e o número em WHATSAPP_SANDBOX_NUMBERS; a Twilio permite entrega somente aos participantes do Sandbox associado. A sessão expira após três dias; envie novamente join com o código do seu Sandbox quando necessário. Estar na lista local não substitui a adesão.

A resposta automática exige autorização e consentimento, assim como os alertas. Números fora da lista, sem consentimento ou de empresas sem autorização recebem TwiML vazio. Receber uma mensagem não cria consentimento nem modifica o plano. Repetições do mesmo MessageSid são ignoradas; se a resposta inicial se perder após o registro, uma nova mensagem permite testar novamente.

O Sandbox usa texto livre apenas dentro da janela ativa. Fora dela, o alerta fica aguardando uma nova mensagem; não é enviado conteúdo de licitação em templates genéricos do Sandbox. Esta etapa não envia mensagens reais nos testes automatizados.

## Produção e modelos aprovados

Mantenha o envio em produção desativado até existir remetente comercial aprovado e conteúdo aprovado pela Meta. Após verificar ambos no painel Twilio, configure o remetente comercial, WHATSAPP_MODE=production, WHATSAPP_PRODUCTION_READY=true e TWILIO_WHATSAPP_CONTENT_SID=HX...; somente então considere WHATSAPP_ENABLED=true.

O flag PRODUCTION_READY é uma confirmação operacional: o código não consulta o status de aprovação na Meta. Sem essa confirmação e ContentSid, a configuração de produção habilitada é rejeitada.

O envio em produção sempre usa ContentSid/ContentVariables, inclusive dentro das 24 horas. Não há fallback para texto livre. Crie conteúdo com seis variáveis textuais posicionais:

| Variável | Campo |
| --- | --- |
| 1 | Objeto (até 400 caracteres) |
| 2 | Órgão/unidade gestora (até 100 caracteres) |
| 3 | Município (até 200 caracteres) |
| 4 | UF |
| 5 | Compatibilidade, sem símbolo % |
| 6 | Link oficial da oportunidade, ou Link não disponível |

Exemplo de corpo:

Objeto: {{1}}
Órgão: {{2}}
Município/UF: {{3}}/{{4}}
Compatibilidade: {{5}}%
Oportunidade: {{6}}

Use um template de corpo compatível, sem cabeçalho ou botões obrigatórios adicionais. Quando faltarem dados, o resumo informa Não informado/N/D. O link usa somente URLs HTTP(S) válidas fornecidas pela fonte, sem inventar endereço do edital.

## Histórico e falhas

whatsapp_inbound registra somente MessageSid, número e horário de mensagens autorizadas, sem armazenar corpo. alertas_empresa_whatsapp registra empresa, oportunidade, usuário, destinatário, estado, código numérico de erro e SID do provedor. A unicidade é por empresa/oportunidade/número, evitando duplicação por interesses ou usuários com o mesmo telefone.

O worker revalida plano, empresa, usuário, consentimento e número na reserva atômica antes do HTTP. A seleção exige 67%, interesse ativo, match novo/aceito e a regra regional/modalidade existente. A migration preserva tentativas antigas e impede reenvio de alertas já processados no adaptador anterior. O histórico do e-mail não é modificado.

Estados: enviando (reservado), enviado (aceito pela Twilio com SID), falhou (rejeição definitiva HTTP 4xx), incerto (erro de transporte/resultado não confirmado). Não há reenvio automático de falhas, resultados incertos ou reservas interrompidas; revisão manual requer consultar primeiro o SID/logs no painel Twilio. Isso privilegia evitar duplicações, podendo deixar uma mensagem sem envio após falha. A aceitação não confirma entrega/leitura; callbacks de status não estão incluídos nesta etapa.

Erros brutos, tokens, conteúdo e números não são registrados nos logs desta integração. O banco armazena os números necessários para consentimento e histórico.

## Verificação

npm test

Os testes cobrem SDK simulado, configuração, assinatura e URL pública atrás de proxy, resposta exata, replay, autorização, janela, template, SQL real via PGlite, limite de 67%, deduplicação e isolamento do e-mail. Nenhum teste chama a Twilio real. Os testes também verificam flags independentes, boas-vindas e histórico com alertas desativados, e bloqueio da fila/worker nessa configuração. A validação de entrega real e participação ativa deve ser feita no Sandbox configurado.

Referências oficiais:
- https://www.twilio.com/docs/usage/webhooks/webhooks-security
- https://www.twilio.com/docs/whatsapp/sandbox
- https://www.twilio.com/docs/whatsapp/tutorial/send-whatsapp-notification-messages-templates

## Diagnóstico de rejeições do webhook

Os logs da aplicação usam `event=whatsapp.webhook.decision`, `requestId`, `status` e `reason`. O `requestId` também aparece no cabeçalho `X-Request-Id` e no log de conclusão da requisição; não é necessariamente o ID dos Network Logs do Railway. Procure pelo horário e depois correlacione esses registros. Configure LOG_LEVEL=info para visualizar também os resultados 200; warn mostra as rejeições.

| HTTP | reason | Conferência |
| --- | --- | --- |
| 403 | public_url_mismatch | Caminho e query recebidos devem coincidir exatamente com WHATSAPP_WEBHOOK_URL |
| 403 | signature_missing | A chamada deve ser feita pela Twilio com X-Twilio-Signature |
| 403 | signature_invalid | Conferir Auth Token da conta/subconta, URL HTTPS exata na Twilio e todos os parâmetros do formulário |
| 403 | account_sid_mismatch | TWILIO_ACCOUNT_SID deve pertencer ao Sandbox que chamou a aplicação |
| 403 | recipient_mismatch | TWILIO_WHATSAPP_FROM deve ser whatsapp:+ seguido do número do Sandbox, não o celular de teste |
| 400 | message_sid_invalid / sender_invalid | MessageSid e remetente precisam ter formato válido; número móvel brasileiro com DDD válido e oito ou nove dígitos |
| 415 | unsupported_content_type | Usar POST application/x-www-form-urlencoded |
| 503 | auth_token_missing / database_failure | Verificar configuração ou banco; falha SQL usa event=whatsapp.webhook.failed |
| 200 | webhook_disabled / sandbox_number_not_allowed / sender_not_eligible / duplicate_message | TwiML vazio, sem resposta WhatsApp |
| 200 | welcome_replied | Boas-vindas incluídas no TwiML; entrega deve ser conferida na Twilio |

A lista de números usa +55DDDNUMERO, sem prefixo whatsapp:, e aceita espaços apenas em torno dos itens separados por vírgulas. O remetente é normalizado somente depois da validação da assinatura. Nenhum desses logs registra token, assinatura, número, SID, corpo, URL/query ou erro SQL bruto.

Para formulários, a assinatura utiliza todos os pares de parâmetros decodificados pelo parser, incluindo campos futuros; não utiliza o buffer bruto. A aplicação não filtra nem normaliza esses valores antes da validação. A URL externa HTTPS configurada é usada literalmente pelo SDK; o protocolo HTTP interno do Railway e os headers Host/X-Forwarded-* não a substituem. Não tente resolver um 403 removendo a validação ou usando URL interna.

Somente horários e status dos Network Logs não permitem determinar qual validação falhou em uma requisição antiga. Os códigos acima permitem identificar a causa nas próximas chamadas após publicação manual desta versão. Mantenha WHATSAPP_ENABLED=false, WHATSAPP_WEBHOOK_ENABLED=true, WHATSAPP_MODE=sandbox e WHATSAPP_PRODUCTION_READY=false durante o diagnóstico.

## Formato do remetente brasileiro

O webhook exige `From` único no formato `whatsapp:+55DDDNUMERO`, sem espaços, pontuação ou escapes ainda codificados: 12 ou 13 dígitos após o +, DDD brasileiro válido e número local de nove dígitos começando em 9 ou representação móvel de oito dígitos começando em 6–9. O resultado precisa coincidir com WHATSAPP_SANDBOX_NUMBERS e com o cadastro autorizado. Nenhum dígito é acrescentado ou removido do endereço recebido.

No corpo application/x-www-form-urlencoded, `%2B` vira `+` uma única vez; um `+` literal vira espaço. Não há decodeURIComponent adicional, substituição de espaço por `+` nem alteração de req.body antes da assinatura. Campos From duplicados, escapes duplos e formatos inválidos são rejeitados.

Quando reason=sender_invalid, o campo senderReason identifica a causa sem expor dados: from_duplicated, from_not_string, from_prefix_invalid, from_characters_invalid, from_country_invalid, from_length_invalid ou from_mobile_format_invalid. O diagnóstico ocorre somente depois da assinatura válida. Ter 13 dígitos não garante que prefixo, DDD e indicador inicial 9 do celular sejam válidos. Para identificar a causa de uma chamada específica, consulte esse código após publicação manual; o log anterior sender_invalid não contém detalhe suficiente.

A migration 018_whatsapp_number_formats.sql permite cadastrar a representação com oito dígitos sem alterar registros existentes. Deve ser aplicada pelo processo habitual antes do teste; não foi aplicada no Railway nesta alteração. Para evitar associação ambígua, não há equivalência automática entre oito e nove dígitos: o From, WHATSAPP_SANDBOX_NUMBERS e o número salvo na conta com consentimento devem corresponder exatamente. Se a representação mudar, o responsável deve salvar a nova preferência e confirmar novamente o consentimento. Somente receber uma mensagem não altera cadastro ou consentimento.

A regra restrita é compartilhada entre validador, configuração e elegibilidade SQL. Rejeita DDD inexistente, números fixos, país diferente, comprimento incorreto, duplicados e caracteres extras. A migração preserva dados históricos usando NOT VALID: escritas novas são validadas, sem reescrever registros antigos. WHATSAPP_ENABLED=false continua bloqueando todos os alertas automáticos.

## Envio administrativo único de uma licitação real

Aplique a migration 019 pelo fluxo habitual. Mantenha `WHATSAPP_ENABLED=false`,
`WHATSAPP_PRODUCTION_READY=false` e `WHATSAPP_MODE=sandbox`. O comando não inicia
servidor, worker nem agendador. Informe explicitamente a empresa de teste por CNPJ ou ID e
seu gestor/admin por e-mail cadastrado ou ID; a seleção usa matches reais de pelo menos 67%, plano Premium,
consentimento, preferência ativa, regras regionais e lista do Sandbox.

A seleção percorre os candidatos por `m.score DESC, l.id, m.id`, em páginas de
100 registros, até encontrar o primeiro com link válido. Prioriza `link_edital`
validado por `safeOfficialUrl()` e usa `url_fonte` validado como alternativa.
Se nenhum candidato tiver link válido, a prévia falha sem reservar tentativa.
O mesmo link aparece na prévia, integra o token de confirmação e é enviado.
Antes da reserva, a seleção e o link são revalidados; mudanças na oportunidade
ou no link escolhido exigem uma nova prévia. Nenhum link é criado ou atualizado
no banco por essa seleção.

1. Envie uma mensagem ao Sandbox com o próprio número autorizado. O webhook
   autorizado precisa registrar essa mensagem em `whatsapp_inbound`.
2. Execute `npm run whatsapp:test:sandbox -- --empresa ID --usuario ID` para
   revisar destinatário, oportunidade e token de confirmação. Para a empresa solicitada, use `--cnpj 68.700.104/0001-42` no lugar de `--empresa ID`. Para identificar sua conta sem consultar o ID, substitua `--usuario ID` por `--email seu@email.com`. O e-mail deve identificar uma única conta dentro da empresa selecionada; todas as regras de elegibilidade continuam obrigatórias. A prévia não envia.
3. Autorize somente o comando com `WHATSAPP_SANDBOX_TEST_ENABLED=true` e execute
   o comando com `--confirm TOKEN` exibido na prévia.
4. Confira o SID no Console Twilio e o recebimento no aparelho. Aceitação pela API
   não significa entrega. Volte `WHATSAPP_SANDBOX_TEST_ENABLED=false` após o teste.

Uma reserva persistente em `whatsapp_sandbox_test` permite uma única tentativa no
banco, inclusive em execuções concorrentes ou quando o resultado for incerto.
O histórico normal também impede envio repetido dessa oportunidade. Não apague
reservas para repetir uma chamada cujo resultado ainda não foi esclarecido.

Fora das 24 horas, o comando bloqueia o alerta e pede nova mensagem recebida.
O Sandbox aceita apenas seus templates pré-aprovados, que não representam este
alerta completo; não inserir objeto de licitação em variáveis de templates com
outra finalidade. Templates personalizados exigem ambiente de produção aprovado.
O esquema atual não persiste valor estimado; quando ausente, a mensagem omite esse
campo. O adaptador aceita `valorEstimado` quando disponível.
