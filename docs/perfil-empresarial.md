# Perfil Empresarial

## Análise e implementação

O cadastro anterior já continha CNPJ numérico único, razão social, nome fantasia,
e-mail, telefone, cidade e UF em `empresas`. Esses dados foram reaproveitados.
`interesses` já contém títulos e palavras-chave usados na análise das licitações:
continua independente do novo catálogo. Não havia infraestrutura de upload seguro.

A migration aditiva `015_company_profile.sql` cria:

| Tabela | Dados |
| --- | --- |
| empresa_perfil | Atendimento nacional; capacidade (quantidade, unidade, período, descrição); ticket mínimo/máximo; margem; entrega (quantidade e unidade) |
| empresa_atividades | CNAE principal/secundário e atividade efetiva, código e descrição |
| empresa_produtos_servicos | Tipo, nome, descrição, categoria, palavras-chave em array, especificações, unidade, capacidade |
| empresa_marcas | Marca, fabricante, marcas equivalentes em array, produtos equivalentes |
| empresa_regioes | Estado, macrorregião ou município com UF |
| empresa_documentos | Tipo de documento disponível e observação |
| empresa_certificacoes | Nome, número, órgão emissor, validade, observação |
| empresa_restricoes | Tipo e descrição |

Todas têm vínculo com `empresas`, índices por empresa e constraints. Nenhum dado
existente é apagado, copiado ou preenchido com suposições. A migração não modifica
`interesses`, `matches`, filtros ou funções de seleção das licitações. Documentos
recebem IDs próprios para futura associação com armazenamento seguro, mas não há
upload nem campos de URLs de arquivos nesta etapa.

## Interface e autorização

Acesse **Perfil empresarial** no menu ou **Completar perfil** no Dashboard.
Existem sete blocos expansíveis, com salvamento independente: Empresa, Atividades,
Produtos e Serviços, Área de Atendimento, Capacidade Comercial, Documentação,
Restrições. Catálogo inclui marcas/equivalências; documentação inclui certificações.
As listas permitem adicionar/remover registros; palavras-chave e marcas equivalentes
usam tags. Os estados têm pesquisa por nome/UF, e regiões têm sugestões.

Gestores e administradores editam. Usuários comuns consultam somente sua empresa.
A margem está na tabela privada de perfil, nunca no cadastro público ou nos dados
transmitidos a fontes de licitações. Somente sessões da própria empresa e admins
autorizados consultam o perfil. O administrador encontra **Ver perfil** na lista de
empresas, preservando as ações administrativas anteriores.

Os endpoints comuns usam exclusivamente a empresa da sessão. Não aceitam IDs de
empresa ou de registros no corpo. Endpoints administrativos exigem `requireAdmin`.
Todas as alterações exigem CSRF. As respostas têm `Cache-Control: no-store`.

Cada salvamento substitui as listas **da seção e da empresa correspondente**, em
transação com lock da empresa. Outras seções permanecem intactas. A interface
preserva campos após erros, avisa sobre alterações não salvas ao sair e distingue
alterações feitas enquanto uma requisição estava em andamento. Não guarda dados
comerciais em localStorage. Alterações não salvas não sobrevivem ao fechamento
forçado do navegador; salve cada seção durante o preenchimento.

## Endpoints

| Método | Rota | Acesso |
| --- | --- | --- |
| GET | /empresa | Tela da própria empresa |
| GET | /api/empresa | Cadastro existente, agora também com perfil e completude |
| POST / PATCH | /empresa / /api/empresa | Edição básica anterior preservada |
| GET | /api/empresa/perfil | Perfil da própria empresa |
| PATCH | /api/empresa/perfil/:section | Gestor/admin da própria empresa |
| GET | /admin/empresas/:id/perfil | Tela administrativa |
| GET | /api/admin/empresas/:id/perfil | Admin |
| PATCH | /api/admin/empresas/:id/perfil/:section | Admin |

Seções: `empresa`, `atividades`, `catalogo`, `atendimento`, `comercial`,
`documentacao`, `restricoes`. GET e PATCH retornam `{ company, profile, completion }`.
Os formatos dos corpos estão nos schemas em `src/utils/companyProfile.js` e nos
cenários completos em `test/companyProfile.test.js`. Para limpar uma lista, envie
`[]`; todas as listas da seção devem estar presentes. Em `empresa`, envie os dados
básicos e CNPJ. O máximo de oportunidade pode ser vazio ou null.

Exemplo de corpo para `PATCH /api/empresa/perfil/atendimento`:

```json
{
  "atendimento_nacional": false,
  "regioes": [
    {"tipo": "estado", "estado": "RN", "nome": ""},
    {"tipo": "municipio", "estado": "PB", "nome": "João Pessoa"}
  ]
}
```

## Validações

- CNPJ obrigatório, máscara na tela, dígitos verificadores no servidor e unicidade no banco.
- Razão social/e-mail obrigatórios, UF válida e limites de texto.
- CNAEs com sete dígitos; apenas um principal; sem repetição entre CNAEs cadastrados.
- Atividades efetivas independentes dos CNAEs registrados.
- Campos obrigatórios por registro, enums, no máximo 100 registros por lista e 50 tags.
- Valores não negativos, margem entre 0 e 100 e máximo de ticket maior ou igual ao mínimo.
- Capacidade positiva; quantidade exige unidade e período.
- Entrega em número inteiro positivo com unidade; quantidade e unidade devem vir juntas.
- Municípios exigem UF e nome; macrorregiões são validadas; nacional exclui regiões específicas.
- Datas de validade reais, sem exigir que uma certificação já cadastrada esteja vigente.
- Campos desconhecidos, IDs e tentativas de alterar permissões são rejeitados.
- Conteúdo renderizado com escape e tags criadas via textContent.

## Completude

Calculada no servidor, a cada leitura/salvamento, por 12 critérios de mesmo peso:

1. Razão social e CNPJ válido.
2. E-mail e telefone.
3. Cidade e UF.
4. CNAE principal.
5. Atividade efetivamente explorada.
6. Pelo menos um produto/serviço com nome, descrição ou especificações, e unidade.
7. Atendimento nacional ou ao menos uma região.
8. Descrição operacional ou capacidade com quantidade, unidade e período.
9. Ticket mínimo informado (zero é válido; máximo é opcional).
10. Margem mínima informada (zero é válido).
11. Prazo com quantidade e unidade.
12. Pelo menos um documento disponível.

`percentual = round(critérios preenchidos / 12 * 100)`. CNAEs secundários,
marcas, certificações e restrições são opcionais, pois podem não se aplicar.
O retorno inclui a lista booleana dos critérios e os totais. O Dashboard apresenta
barra, percentual e CTA. A completude não muda pesos, mínimo de **67%**, fórmula,
filtros, interesses ou resultado de match. Os dados estão preparados para uso
futuro, sem integração automática com o algoritmo.

## Teste manual

1. No ambiente desejado, aplique `npm run db:migrate` com a configuração de banco correta.
2. Entre como gestor e abra `/empresa`. Confira os dados básicos preexistentes.
3. Edite e salve Empresa; teste CNPJ inválido e CNPJ de outra empresa.
4. Adicione CNAE principal, secundários e atividades efetivas; salve Atividades.
5. Adicione produto e serviço, tags, unidade, capacidade e equivalências; salve.
6. Cadastre estados/municípios ou atendimento nacional e salve.
7. Preencha capacidade, ticket mínimo/máximo, margem e prazo; salve.
8. Cadastre documento e certificação; salve. Adicione restrições se aplicáveis.
9. Reabra a página: os dados devem persistir. Edite/remova um registro e salve
   somente sua seção. Verifique que outras seções não foram alteradas.
10. Confira o percentual no Dashboard e no perfil. Complete os 12 critérios para 100%.
11. Entre com outra empresa: ela não deve ver o perfil nem a margem anterior.
12. Como usuário comum, confira leitura sem edição. Como admin, use Ver perfil.
13. Verifique erro de rede/validação: os campos devem permanecer preenchidos e
    o botão deve permitir nova tentativa. Teste aviso ao sair sem salvar.

Teste automatizado com banco PostgreSQL em memória:

```sh
node --test test/companyProfile.test.js test/auth.test.js test/matches.test.js test/regionalRule.test.js
npm test
```

## Arquivos

Novos: `migrations/015_company_profile.sql`, `src/services/companyProfileService.js`,
`src/utils/companyProfile.js`, `src/utils/companyProfileFields.js`,
`src/views/account/profile/fields.ejs`, `src/public/company-profile.js`,
`test/companyProfile.test.js`, `docs/perfil-empresarial.md`.

Alterados: `src/controllers/accountController.js`, `src/routes/accountRoutes.js`,
`src/services/accountService.js`, `src/views/account/company.ejs`,
`src/views/account/home.ejs`, `src/views/account/admin.ejs`,
`src/views/partials/nav.ejs`, `src/public/account.css`,
`src/services/databaseCheckService.js`, `test/foundation.test.js`,
`test/deploy.test.js`, `test/operations.test.js`.
O adaptador do teste de migrations também reconhece ALTER TABLE após comentários SQL,
como já ocorre na migration 013 existente. A checagem de deploy exige as novas
tabelas; a expectativa antiga de ausência de Usuários no menu foi corrigida para
o comportamento já existente de gestores, sem alterar permissões ou navegação.
