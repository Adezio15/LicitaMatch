# Fontes e alertas no Railway

As alterações precisam ser publicadas no serviço de produção. O Railway injeta as variáveis; editar `.env` local ou `.env.production.example` não altera o site publicado.

## Compras.gov.br

Defina `WORKER_ENABLED=true`, `SYNC_ENABLED=true` e `COMPRASNET_ENABLED=true`. A última variável agora também tem padrão `true` em produção; um `false` explícito continua desativando a fonte. O worker precisa da conexão direta ao banco quando a aplicação usa pooling. Consulte `/admin/operacao` para conferir as execuções, além do indicador de ativação.

## E-mail

O [Railway permite SMTP apenas no plano Pro ou superior](https://docs.railway.com/networking/outbound-networking). Nos demais planos, use a integração HTTPS implementada com a [API Resend](https://resend.com/docs/api-reference/emails/send-email):

- `EMAIL_PROVIDER=resend`
- `RESEND_API_KEY`: chave do provedor, configurada apenas nas Variables do serviço.
- `EMAIL_FROM`: endereço de um domínio verificado no provedor.
- `EMAIL_ENABLED=true`

Para manter SMTP em plano compatível, configure `EMAIL_PROVIDER=smtp`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` e `EMAIL_ENABLED=true`.

Sem `EMAIL_ENABLED` explícito, o canal é ativado quando todas as credenciais do provedor escolhido estão presentes. `EMAIL_ENABLED=false` continua impedindo envios.

## WhatsApp

Configure `WHATSAPP_ENABLED=true`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION`, `WHATSAPP_TEMPLATE_NAME` e `WHATSAPP_TEMPLATE_LANGUAGE=pt_BR`. Sem flag explícita, o canal é ativado quando todas as credenciais estão presentes. O template precisa estar aprovado e ter os parâmetros descritos em [WHATSAPP.md](WHATSAPP.md).

O gestor ou administrador precisa salvar o celular e confirmar o recebimento na própria conta. A preferência de e-mail é independente. Não basta ativar a flag de envio sem número e consentimento.

## Verificação após publicar

Oportunidades e alertas seguem a regra regional: pregão eletrônico em todo o Brasil; pregão presencial apenas em RN e PB. Outras modalidades e pregões sem forma identificada ficam fora. Presenciais sem UF confirmada também ficam fora. A UF é a da unidade contratante informada pela fonte, não a da empresa usuária.

A migration `009_regional_pregao.sql` adiciona a UF e a regra compartilhada. Registros antigos são preservados; uma nova coleta do mesmo código externo complementa a UF. Enquanto não forem reimportados, presenciais antigos sem UF não aparecem nem geram envios. Alertas já enviados permanecem no histórico; pendentes fora da regra não são enviados.

Abra `/admin/operacao`: os diagnósticos mostram nomes das configurações ausentes, sem expor valores. Confira `WORKER_ENABLED`, as tarefas `alertas` e `alertas_whatsapp`, a fila e os logs de falhas. Os alertas exigem interesses ativos, correspondências com score mínimo (padrão 70) e destinatários ativos com preferência habilitada. O status enviado significa aceitação pelo provedor, não entrega ou leitura.

Tentativas pendentes são repetidas a cada 15 minutos, até cinco tentativas. Alertas já marcados como `falhou` precisam de recuperação operacional após corrigir a causa; uma publicação não os reenvia automaticamente.
