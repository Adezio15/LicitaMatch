> Política vigente: [WhatsApp somente notificações](whatsapp-notifications-only.md).
> As regras abaixo são históricas; respostas de boas-vindas foram desabilitadas,
> produção usa quatro variáveis e licitações antigas também são excluídas.

# Preparação dos alertas automáticos WhatsApp

Estas alterações não habilitam flags, não configuram Twilio e não recuperam oportunidades antigas.

## Regras

- O envio automático exige `safeOfficialUrl(link_edital) || safeOfficialUrl(url_fonte)` antes de reservar. O endereço validado é o mesmo enviado ao provedor. Se os campos mudarem antes da reserva, o candidato é rejeitado e poderá ser reavaliado no ciclo seguinte. Links inválidos não geram reserva nem bloqueiam oportunidades válidas posteriores no lote.
- `usuarios.whatsapp_habilitado_em` marca a entrada na elegibilidade: usuário ativo, gestor/admin, número, preferência e consentimento, empresa ativa e Premium efetivo. Ativação, reativação e troca de número renovam o marco. Desativação, suspensão, perda de perfil ou de Premium removem o marco. Upgrade/restabelecimento o renova, mesmo sem novo login.
- Os triggers cobrem também mudanças feitas pelos serviços administrativos e de teste Premium. Expiração por passagem de tempo é bloqueada por `plano_efetivo()`; assinatura ou renovação depois da expiração cria novo marco. Conversão de teste vigente para Premium pago preserva a continuidade.
- Salvar nome, perfil da empresa, preferência de e-mail ou repetir a mesma configuração WhatsApp não reinicia o marco. A rota preserva também a data de consentimento quando número e preferência continuam iguais.
- A primeira execução do worker com WhatsApp e produção explicitamente habilitados grava, uma única vez, `whatsapp_ativacao_producao.ativado_em`. A tabela permanece vazia após a migration. Reinícios, concorrência e desligar/religar o worker preservam esse marco.
- Em produção, `matches.created_at` deve ser estritamente posterior ao marco do destinatário e ao marco global. No envio automático Sandbox exige-se o marco do destinatário, preservando lista autorizada e janela de atendimento. O comando manual de teste Sandbox permanece independente.
- `created_at`, e não `updated_at`, é usado: recalcular score de um match antigo não o transforma em novo. O critério se refere a matches novos; um novo interesse pode gerar um novo match para uma licitação já no catálogo. Os históricos de envio ainda impedem repetir a mesma licitação para o mesmo destinatário/empresa.
- Timestamps são comparados no PostgreSQL com precisão completa. Transações iniciadas antes do marco, cujo `created_at` usa `now()`, são excluídas conservadoramente, mesmo se terminarem depois dele.
- A reserva revalida o marco, score mínimo de 67, interesse ativo, status do match, modalidade/UF e todos os controles anteriores de destinatário. Não há consulta externa de recuperação no envio.

## Ativação futura, mediante autorização

1. Manter `WHATSAPP_ENABLED=false`, `WHATSAPP_PRODUCTION_READY=false` e `WHATSAPP_SANDBOX_TEST_ENABLED=false` durante a preparação.
2. Em janela autorizada, aplicar somente a nova migration `020_whatsapp_activation.sql` pelo fluxo habitual de migrations, antes de executar a nova versão do worker. Ela adiciona coluna, tabela, triggers e índice; inicializa os marcos dos usuários existentes no instante da migration. Não modifica matches, links, consentimento, preferências ou histórico de mensagens.
3. Conferir schema e executar os testes locais. Conferir remetente aprovado e template da conta Twilio, com as seis variáveis usadas pelo adaptador. Nenhuma configuração Twilio é alterada por esta implementação.
4. Quando autorizado a iniciar envios, configurar produção com `WHATSAPP_MODE=production`, `WHATSAPP_PRODUCTION_READY=true`, `WHATSAPP_ENABLED=true`, `WHATSAPP_SANDBOX_TEST_ENABLED=false`, credenciais e template corretos, além de worker/sincronização habilitados. O primeiro ciclo cria o marco global e descarta os matches anteriores a ele, inclusive os gerados entre a migration e esse ciclo.
5. Conferir, somente por leitura:

```sql
SELECT ativado_em FROM whatsapp_ativacao_producao WHERE id=true;
SELECT id, empresa_id, whatsapp_habilitado_em
FROM usuarios WHERE alertas_whatsapp=true;
```

6. Acompanhar uma oportunidade com match realmente novo, score >=67 e link válido pelos logs e pelo Console Twilio. Aceitação pela API continua distinta de entrega confirmada.

Não apagar nem retroceder os marcos para tentar reenviar estoque. Repetir a mesma migration fora do controle do migrador não é um procedimento de reativação. Desligar/religar o serviço conserva o marco global; matches gerados durante essa pausa, posteriores aos dois marcos e ainda elegíveis, podem ser enviados ao retomar.
