import { states } from './validation.js';
const field = (name, label, type = 'text', extra = {}) => ({ name, label, type, ...extra });
const select = (name, label, options) => field(name,label,'select',{ options });
const options = values => values.map(value => [value,value]);
const unit = field('unidade','Unidade de medida','text',{ list: 'profile-units', max: 80 });
export const profileSections = [
  { id: 'empresa', title: 'Empresa', description: 'Identificação e contatos da sua empresa.', fields: [
    field('cnpj','CNPJ','text',{ required: true, max: 18, mask: 'cnpj' }), field('razao_social','Razão social','text',{required:true}), field('nome_fantasia','Nome fantasia'), field('email_empresa','E-mail','email',{required:true,max:254}), field('telefone','Telefone','tel',{max:30}), field('cidade','Cidade','text',{max:100}), select('estado','Estado',[['','Selecione'],...options(states)])
  ]},
  { id: 'atividades', title: 'Atividades', description: 'Separe os CNAEs cadastrados das atividades que a empresa realmente exerce.', groups: [
    { name: 'atividades', title: 'CNAEs e atividades efetivamente exploradas', add: 'Adicionar atividade', fields: [select('tipo','Tipo',[['principal','CNAE principal'],['secundario','CNAE secundário'],['efetiva','Atividade efetivamente explorada']]),field('cnae','Código CNAE (7 dígitos)','text',{max:10}),field('descricao','Descrição da atividade','textarea',{required:true,max:1000})] }
  ]},
  { id: 'catalogo', title: 'Produtos e Serviços', description: 'Organize seu catálogo com unidades, especificações e equivalências por registro.', groups: [
    { name: 'produtos', title: 'Produtos e serviços oferecidos', add: 'Adicionar produto ou serviço', fields: [select('tipo','Tipo',[['produto','Produto'],['servico','Serviço']]), field('nome','Nome','text',{required:true}),field('descricao','Descrição','textarea',{max:2000}),field('categoria','Categoria'),field('palavras_chave','Palavras-chave','tags'),field('especificacoes','Especificações técnicas','textarea',{max:4000}),unit,field('capacidade','Capacidade aproximada de fornecimento','textarea',{max:1000})] },
    { name: 'marcas', title: 'Marcas e equivalências aceitas', add: 'Adicionar marca ou equivalência', fields: [field('marca','Marca comercializada'),field('fabricante','Fabricante'),field('marcas_equivalentes','Marcas equivalentes','tags'),field('produtos_equivalentes','Produtos similares ou equivalentes','textarea',{max:2000})] }
  ]},
  { id: 'atendimento', title: 'Área de Atendimento', description: 'Onde sua empresa atende? Selecione todo o Brasil ou adicione estados, regiões e municípios.', fields: [field('atendimento_nacional','Atendo todo o território nacional','checkbox')], groups: [
    { name: 'regioes', title: 'Regiões atendidas', add: 'Adicionar região', fields: [select('tipo','Abrangência',[['estado','Estado'],['regiao','Região'],['municipio','Município']]),select('estado','Estado',[['','Selecione'],...options(states)]),field('nome','Região ou município','text',{max:150,list:'profile-regions'})] }
  ]},
  { id: 'comercial', title: 'Capacidade Comercial', description: 'Informe sua capacidade operacional e a faixa de oportunidades desejada. Estes dados são privados da empresa e dos administradores autorizados.', fields: [
    field('capacidade_quantidade','Quantidade de fornecimento/produção','number',{min:0.001,step:0.001}),field('capacidade_unidade','Unidade da capacidade','text',{list:'profile-units',max:80}),select('capacidade_periodo','Período da capacidade',[['','Selecione'],['dia','Por dia'],['mes','Por mês'],['pedido','Por pedido'],['outro','Outro (descreva abaixo)']]),field('capacidade_descricao','Descrição da capacidade operacional','textarea',{max:2000}),field('oportunidade_min','Valor mínimo da oportunidade (R$)','number',{min:0,step:0.01}),field('oportunidade_max','Valor máximo desejado (R$) — opcional','number',{min:0,step:0.01}),field('margem_min','Margem mínima desejada (%)','number',{min:0,maxValue:100,step:0.01,help:'Informe a margem mínima que normalmente considera viável para uma oportunidade.'}),field('entrega_quantidade','Prazo máximo de entrega — quantidade','number',{min:1,maxValue:36500,step:1}),select('entrega_unidade','Unidade do prazo',[['','Selecione'],['dias_uteis','Dias úteis'],['dias_corridos','Dias corridos']])
  ]},
  { id: 'documentacao', title: 'Documentação', description: 'Cadastre os documentos disponíveis e seus registros técnicos. Nesta etapa, informe somente os tipos; o envio de arquivos ficará para uma etapa futura.', groups: [
    { name: 'documentos', title: 'Documentação e capacidade técnica', add: 'Adicionar documento disponível', fields: [field('tipo','Tipo de documento','text',{required:true,list:'profile-documents'}),field('observacao','Observação','textarea',{max:1000})] },
    { name: 'certificacoes', title: 'Certificações e registros', add: 'Adicionar certificação ou registro', fields: [field('nome','Nome','text',{required:true,list:'profile-certifications'}),field('numero','Número'),field('orgao_emissor','Órgão emissor'),field('validade','Validade','date'),field('observacao','Observação','textarea',{max:1000})] }
  ]},
  { id: 'restricoes', title: 'Restrições', description: 'Registre limitações comerciais ou logísticas. Se não houver restrições, deixe esta seção vazia.', groups: [
    { name: 'restricoes', title: 'Restrições comerciais/logísticas', add: 'Adicionar restrição', fields: [select('tipo','Tipo',[['regiao','Região não atendida'],['quantidade_minima','Quantidade mínima por pedido'],['prazo','Prazo adicional'],['produto','Produto indisponível'],['modalidade','Modalidade não atendida'],['outra','Outra limitação']]),field('descricao','Descrição da restrição','textarea',{required:true,max:2000})] }
  ]}
];
