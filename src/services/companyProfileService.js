import { profileSchemas, profileCompletion } from '../utils/companyProfile.js';
import { validate } from '../utils/validation.js';
import { HttpError } from '../utils/httpError.js';

const collections = {
  atividades: ['empresa_atividades', ['tipo','cnae','descricao']],
  produtos: ['empresa_produtos_servicos', ['tipo','nome','descricao','categoria','palavras_chave','especificacoes','unidade','capacidade']],
  marcas: ['empresa_marcas', ['marca','fabricante','marcas_equivalentes','produtos_equivalentes']],
  regioes: ['empresa_regioes', ['tipo','estado','nome']],
  documentos: ['empresa_documentos', ['tipo','observacao']],
  certificacoes: ['empresa_certificacoes', ['nome','numero','orgao_emissor','validade','observacao']],
  restricoes: ['empresa_restricoes', ['tipo','descricao']]
};
const commercialColumns = ['capacidade_quantidade','capacidade_unidade','capacidade_periodo','capacidade_descricao','oportunidade_min','oportunidade_max','margem_min','entrega_quantidade','entrega_unidade'];
const emptyCommercial = { capacidade_quantidade: null, capacidade_unidade: '', capacidade_periodo: '', capacidade_descricao: '', oportunidade_min: null, oportunidade_max: null, margem_min: null, entrega_quantidade: null, entrega_unidade: '' };

export function companyProfileService(database) {
  async function get(empresaId, db = database) {
    const company = (await db.query('SELECT * FROM empresas WHERE id=$1', [empresaId])).rows[0];
    if (!company) throw new HttpError(404, 'Empresa não encontrada');
    const settings = (await db.query('SELECT * FROM empresa_perfil WHERE empresa_id=$1', [empresaId])).rows[0];
    const profile = { comercial: { ...emptyCommercial }, atendimento_nacional: settings?.atendimento_nacional || false };
    for (const column of commercialColumns) if (settings) profile.comercial[column] = settings[column];
    for (const [name, [table, columns]] of Object.entries(collections)) {
      const select = columns.map(column => column === 'validade' ? "to_char(validade, 'YYYY-MM-DD') AS validade" : column).join(',');
      profile[name] = (await db.query(`SELECT ${select} FROM ${table} WHERE empresa_id=$1 ORDER BY id`, [empresaId])).rows.map(row => Object.fromEntries(Object.entries(row).map(([key,value]) => [key, value ?? ''])));
    }
    return { company, profile, completion: profileCompletion(company, profile) };
  }
  return {
    get,
    async save(empresaId, section, input) {
      if (!Object.hasOwn(profileSchemas, section)) throw new HttpError(404, 'Seção não encontrada');
      const data = validate(profileSchemas[section], input);
      const client = await database.connect();
      try {
        await client.query('BEGIN');
        const exists = await client.query('SELECT id FROM empresas WHERE id=$1 FOR UPDATE', [empresaId]);
        if (!exists.rows[0]) throw new HttpError(404, 'Empresa não encontrada');
        if (section === 'empresa') {
          await client.query(`UPDATE empresas SET cnpj=$2,razao_social=$3,nome_fantasia=$4,email=$5,telefone=$6,cidade=$7,estado=$8 WHERE id=$1`, [empresaId,data.cnpj,data.razao_social,data.nome_fantasia,data.email_empresa,data.telefone,data.cidade,data.estado || null]);
        } else if (section === 'comercial' || section === 'atendimento') {
          await client.query('INSERT INTO empresa_perfil (empresa_id) VALUES ($1) ON CONFLICT DO NOTHING', [empresaId]);
          const columns = section === 'comercial' ? commercialColumns : ['atendimento_nacional'];
          await client.query(`UPDATE empresa_perfil SET ${columns.map((column,i) => `${column}=$${i+2}`).join(',')} WHERE empresa_id=$1`, [empresaId,...columns.map(column => data[column])]);
        }
        for (const [name, [table, columns]] of Object.entries(collections)) {
          if (!Object.hasOwn(data, name)) continue;
          await client.query(`DELETE FROM ${table} WHERE empresa_id=$1`, [empresaId]);
          for (const row of data[name]) {
            const values = columns.map(column => ['cnae','estado','validade'].includes(column) ? row[column] || null : row[column]);
            await client.query(`INSERT INTO ${table} (empresa_id,${columns.join(',')}) VALUES (${[empresaId,...values].map((_,i) => `$${i+1}`).join(',')})`, [empresaId,...values]);
          }
        }
        const result = await get(empresaId, client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    }
  };
}
