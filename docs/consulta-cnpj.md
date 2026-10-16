# Consulta empresarial por CNPJ

O cadastro consulta automaticamente ao sair de um CNPJ completo; o botão permite repetir a consulta. O backend valida os dígitos verificadores numéricos ou alfanuméricos (ASCII menos 48, módulo 11) e chama `https://brasilapi.com.br/api/cnpj/v1/{cnpj}`. Referências: [BrasilAPI](https://brasilapi.com.br/docs#tag/CNPJ) e [Receita Federal](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj).

`POST /api/empresas/consulta-cnpj`, corpo `{ "cnpj": "11222333000181" }`, exige sessão com token CSRF. Está disponível antes do cadastro; usuários autenticados precisam ser gestores ou administradores. Retorna somente os campos empresariais normalizados e `cached`. Não consulta dados privados de empresas cadastradas e não grava no banco.

Limites: 10 consultas por minuto/IP, 10 chamadas externas simultâneas por processo, timeout de 8 segundos. Cache em memória de uma hora, até 500 entradas por processo; reiniciar a aplicação limpa o cache. Instâncias têm caches independentes. Consultas simultâneas do mesmo CNPJ compartilham a chamada. Falhas não entram no cache. Respostas: 422 para CNPJ inválido/rejeitado, 404 para não encontrado, 429 para limites, 502 para falha/resposta inválida e 504 para timeout. O suporte a documentos alfanuméricos na consulta depende também do provedor; rejeições permitem continuar o cadastro manualmente.

No cadastro, campos já digitados são preservados. No perfil existente, é necessário confirmar a aplicação ao formulário. Empresa e Atividades são salvas pelos botões já existentes, com suas validações e permissões. Respostas que chegam após uma edição no formulário são descartadas. O CNAE principal usa `empresa_atividades`, preservando as demais atividades; duplicidades exigem revisão manual. A situação cadastral externa não altera o status interno da conta.

A migração `021_company_cnpj.sql` permite letras na coluna CNPJ, mantém unicidade e adiciona situação cadastral e endereço. Execute `npm run db:migrate` antes de iniciar a versão atualizada (o comando `npm start` já executa as migrações). Clientes antigos que omitem os novos campos não apagam os valores existentes.

Testes: `node --test --test-isolation=none test/cnpj.test.js test/companyProfile.test.js`. A suíte HTTP precisa poder abrir portas locais. As respostas externas são simuladas para testes reproduzíveis.
