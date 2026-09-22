# Alertas por WhatsApp

Responsáveis pelas empresas podem receber os mesmos resumos de oportunidades por e-mail e WhatsApp. No modelo atual, responsável é um usuário com perfil `gestor` ou `admin` vinculado à empresa; não existe um perfil separado de proprietário. O primeiro usuário do cadastro já é gestor.

## Ativação pelo responsável

Em **Minha conta → Alertas pelo WhatsApp**, informe seu celular brasileiro com DDD, escolha **Receber no WhatsApp**, confirme que o número é seu e salve. A configuração pertence exclusivamente ao usuário autenticado e à empresa da sessão. O telefone genérico da empresa não é usado automaticamente.

São aceitos `(84) 99999-9999`, `84999999999` ou `+55 84 99999-9999`. O sistema salva `+5584999999999`. A validação é de formato; não confirma a posse da linha ou a existência de uma conta WhatsApp. Para cancelar os próximos envios, escolha **Não receber** e salve. A preferência de e-mail é independente: para receber nos dois canais, ative ambos.

O administrador verifica a configuração e os totais por canal em **Admin → Operação e fontes**.

## Configuração da API oficial da Meta

O adaptador usa diretamente a WhatsApp Cloud API por HTTPS e `fetch`, sem dependência de sessão de WhatsApp Web.

Configure nas variáveis do servidor:

| Variável | Valor |
| --- | --- |
| `WHATSAPP_ENABLED` | `true` para habilitar; padrão `false` |
| `WHATSAPP_ACCESS_TOKEN` | Token do app com permissão de envio; armazenado somente no servidor |
| `WHATSAPP_PHONE_NUMBER_ID` | ID numérico do telefone remetente no painel Meta; não é o número do destinatário |
| `WHATSAPP_API_VERSION` | Versão ativa do Graph API usada pelo app, no formato `vNN.0`; configure a versão real do painel |
| `WHATSAPP_TEMPLATE_NAME` | Nome do template aprovado, por exemplo `licitamatch_oportunidade` |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Idioma aprovado; padrão `pt_BR` |
| `WORKER_ENABLED` | `true` para processar as filas |
| `ALERT_MIN_SCORE` | Pontuação mínima; padrão `70`, igual ao e-mail |

Não coloque credenciais em formulários públicos, arquivos versionados ou mensagens de suporte. Esta implementação não cria uma conta Meta, registra um remetente ou submete/aprova templates automaticamente. A conta, o número remetente e o template devem estar habilitados no provedor.

## Template

Crie um template com **somente corpo de texto e seis variáveis posicionais**, sem cabeçalho ou botões obrigatórios. Use o mesmo nome e idioma configurados acima. Sugestão de corpo:

```text
Olá, {{1}}.

Uma oportunidade relevante foi identificada para o interesse "{{2}}".

- Pontuação: {{3}}%
- Modalidade: {{4}}
- Unidade gestora: {{5}}
- Objeto: {{6}}

Acesse o painel do LicitaMatch para revisar a oportunidade.
```

Os parâmetros são, nesta ordem: empresa, interesse, score, modalidade, unidade gestora e objeto. O resumo é compartilhado com o e-mail. Textos longos são resumidos com reticências nos dois canais para caber no template; o objeto completo continua disponível no painel. Limites por campo: 80, 100, 3, 60, 100 e 400 caracteres respectivamente. A classificação e aprovação do template são feitas pelo provedor.

## Fila, falhas e histórico

A migration `006_whatsapp_alerts.sql` adiciona número, preferência e data da confirmação ao usuário. Na tabela `alertas`, adiciona canal e ID da mensagem do provedor. Registros antigos continuam como e-mail, preservando seus estados e tentativas. A unicidade passa a ser por oportunidade, usuário e canal.

As tarefas `alertas` e `alertas_whatsapp` são independentes, processam até 25 registros por ciclo e permitem até cinco tentativas com intervalo de 15 minutos. Falhas de um canal não reenviam mensagens já aceitas no outro. Cada envio verifica se empresa, usuário e interesse continuam ativos; WhatsApp exige também perfil de responsável e preferência ativa. Credenciais e respostas brutas do provedor não são registradas nos logs.

No WhatsApp, `enviado` significa que a API aceitou a mensagem e retornou seu ID. **Não é confirmação de entrega ou leitura**; callbacks de entrega ainda não estão implementados. Uma interrupção entre a aceitação externa e a gravação no banco pode resultar em reenvio, como no SMTP. Mensagens já em trânsito não podem ser desfeitas pelo cancelamento da preferência.

## Verificação

```sh
npm.cmd run db:migrate
npm.cmd test
npm.cmd run test:postgres
```

Os testes simulam o provedor: verificam payload do template, erros, dados longos, permissões, confirmação, cancelamento, isolamento entre empresas, independência dos canais e preservação do histórico. Não enviam mensagens reais. A validação de entrega real depende das credenciais e do template aprovado.

Validação desta implementação: 68 testes aprovados, teste com PostgreSQL real aprovado e migration 006 aplicada no banco local preservando os dados.

Referências: [coleção oficial da Meta para a Cloud API](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api) e [exemplo oficial de parâmetros de template](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/template/).
