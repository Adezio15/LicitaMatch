# WhatsApp oficial via Twilio

O adaptador usa o SDK oficial Twilio. E-mail, autenticação e regras comerciais permanecem independentes. A política existente autoriza somente responsáveis (gestor/admin) de empresas ativas com plano efetivo Premium. O gate fica em src/services/whatsappAlertsService.js e é compartilhado com o webhook, permitindo ajustar os planos futuramente sem mudar o adaptador.

## Configuração inicial no Railway

Cadastre as variáveis no serviço da aplicação, sem versionar credenciais:

| Variável | Valor inicial |
| --- | --- |
| TWILIO_ACCOUNT_SID | SID AC... da conta/subconta que recebe o webhook |
| TWILIO_AUTH_TOKEN | Auth Token dessa conta/subconta; nunca API Key secret |
| TWILIO_WHATSAPP_FROM | whatsapp:+NUMERO do Sandbox mostrado na Twilio |
| WHATSAPP_ENABLED | false; ativação sempre explícita |
| WHATSAPP_MODE | sandbox |
| WHATSAPP_WEBHOOK_URL | https://licitamatch.online/api/whatsapp/webhook |
| WHATSAPP_SANDBOX_NUMBERS | Números permitidos, separados por vírgulas, como +5584999999999 |
| WHATSAPP_PRODUCTION_READY | false |
| TWILIO_WHATSAPP_CONTENT_SID | Omitir inicialmente; HX... do conteúdo aprovado na produção |
| WORKER_ENABLED | true para processar alertas; mantém o comportamento existente |

Não altere EMAIL_ENABLED nem as credenciais de e-mail para testar WhatsApp. As antigas variáveis WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_API_VERSION, WHATSAPP_TEMPLATE_NAME e WHATSAPP_TEMPLATE_LANGUAGE não são utilizadas pelo novo adaptador. Mesmo com credenciais completas, WHATSAPP_ENABLED permanece false quando omitida.

A migration 017_twilio_whatsapp.sql deve ser aplicada pelo processo habitual (npm run db:migrate) antes de ativar a integração. Nenhuma migration foi aplicada no banco Railway por esta implementação.

## Webhook e proxy

Em Twilio Console → Sandbox settings → When a message comes in, configure:

https://licitamatch.online/api/whatsapp/webhook

Método HTTP POST, sem query string. Se precisar de parâmetros na URL, configure exatamente a mesma URL, incluindo codificação e query, em WHATSAPP_WEBHOOK_URL.

O endpoint aceita application/x-www-form-urlencoded. O SDK valida X-Twilio-Signature usando todos os parâmetros e a URL pública fixa, antes de consultar o banco. Não deriva essa URL de Host, X-Forwarded-Host ou do protocolo interno do Railway. TRUST_PROXY_HOPS mantém sua função existente para sessões/rate limiting; ajuste conforme a topologia real do serviço, sem necessidade de usá-lo para validar a assinatura. AccountSid e To também são conferidos. O webhook é registrado antes das sessões e não exige login nem CSRF.

Com a integração desativada, requisições assinadas recebem TwiML vazio. Credenciais ausentes retornam 503; assinatura inválida retorna 403.

## Teste do Sandbox

1. Entre no Sandbox pelo código join mostrado na Twilio.
2. Use um responsável ativo de empresa autorizada no LicitaMatch. Em Minha conta → Alertas pelo WhatsApp, informe o celular, confirme o consentimento e salve a preferência. Não use automaticamente o telefone cadastral da empresa.
3. Inclua esse número em WHATSAPP_SANDBOX_NUMBERS.
4. Depois de aplicar a migration e configurar o webhook, ative WHATSAPP_ENABLED=true mantendo WHATSAPP_MODE=sandbox e WHATSAPP_PRODUCTION_READY=false.
5. Envie uma mensagem ao Sandbox. A resposta esperada é: “Olá! Bem-vindo ao LicitaMatch. Em breve você receberá informações sobre oportunidades de licitação.”
6. Uma oportunidade elegível com score mínimo de 67% será enviada pelo worker somente dentro das 24 horas seguintes à mensagem recebida.
7. Ao concluir, volte WHATSAPP_ENABLED=false.

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

Os testes cobrem SDK simulado, configuração, assinatura e URL pública atrás de proxy, resposta exata, replay, autorização, janela, template, SQL real via PGlite, limite de 67%, deduplicação e isolamento do e-mail. Nenhum teste chama a Twilio real. Resultado local: 134 testes aprovados em npm test, executados em Node 26.1.0. O projeto declara Node 24; a validação real do Sandbox e a execução nesse runtime ficam para o ambiente configurado.

Referências oficiais:
- https://www.twilio.com/docs/usage/webhooks/webhooks-security
- https://www.twilio.com/docs/whatsapp/sandbox
- https://www.twilio.com/docs/whatsapp/tutorial/send-whatsapp-notification-messages-templates
