const publicUserColumns = 'id, empresa_id, nome, email, tipo, ativo, created_at, updated_at';

export function accountRepository(database) {
  return {
    async lockCompany(empresaId) {
      await database.query('SELECT id FROM empresas WHERE id=$1 FOR UPDATE', [empresaId]);
    },
    async transaction(work) {
      const client = await database.connect();
      try {
        await client.query('BEGIN');
        const result = await work(accountRepository(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    },
    async createCompany(data) {
      const { rows } = await database.query(`INSERT INTO empresas
        (razao_social, nome_fantasia, cnpj, email, telefone, cidade, estado)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [data.razao_social, data.nome_fantasia, data.cnpj, data.email_empresa, data.telefone, data.cidade, data.estado || null]);
      return rows[0];
    },
    async createUser(empresaId, data, hash) {
      const { rows } = await database.query(`INSERT INTO usuarios (empresa_id,nome,email,senha_hash,tipo)
        VALUES ($1,$2,$3,$4,$5) RETURNING ${publicUserColumns}, auth_version`,
      [empresaId, data.nome, data.email, hash, data.tipo]);
      return rows[0];
    },
    async findLogin(email) {
      const { rows } = await database.query(`SELECT u.*, e.status AS empresa_status
        FROM usuarios u JOIN empresas e ON e.id=u.empresa_id WHERE lower(trim(u.email))=$1`, [email]);
      return rows[0];
    },
    async findSessionUser(id, empresaId) {
      const { rows } = await database.query(`SELECT u.id, u.empresa_id, u.nome, u.email, u.tipo, u.ativo,
        u.auth_version, e.status AS empresa_status, e.nome_fantasia, e.razao_social
        FROM usuarios u JOIN empresas e ON e.id=u.empresa_id WHERE u.id=$1 AND u.empresa_id=$2`, [id, empresaId]);
      return rows[0];
    },
    async getCompany(empresaId) {
      const { rows } = await database.query('SELECT * FROM empresas WHERE id=$1', [empresaId]);
      return rows[0];
    },
    async updateCompany(empresaId, data) {
      const { rows } = await database.query(`UPDATE empresas SET razao_social=$2,nome_fantasia=$3,
        email=$4,telefone=$5,cidade=$6,estado=$7 WHERE id=$1 RETURNING *`,
      [empresaId, data.razao_social, data.nome_fantasia, data.email_empresa, data.telefone, data.cidade, data.estado || null]);
      return rows[0];
    },
    async listUsers(empresaId) {
      const { rows } = await database.query(`SELECT ${publicUserColumns} FROM usuarios WHERE empresa_id=$1 ORDER BY nome, id LIMIT 200`, [empresaId]);
      return rows;
    },
    async getUser(empresaId, id) {
      const { rows } = await database.query(`SELECT ${publicUserColumns} FROM usuarios WHERE empresa_id=$1 AND id=$2`, [empresaId, id]);
      return rows[0];
    },
    async updateUser(empresaId, id, data) {
      const { rows } = await database.query(`UPDATE usuarios SET nome=$3,email=$4,tipo=$5,ativo=$6,
        auth_version=auth_version+1 WHERE empresa_id=$1 AND id=$2 AND tipo <> 'admin'
        RETURNING ${publicUserColumns}`, [empresaId, id, data.nome, data.email, data.tipo, data.ativo]);
      return rows[0];
    },
    async changePassword(empresaId, id, oldHash, newHash) {
      const { rows } = await database.query(`UPDATE usuarios SET senha_hash=$4,auth_version=auth_version+1
        WHERE empresa_id=$1 AND id=$2 AND senha_hash=$3 RETURNING id`, [empresaId, id, oldHash, newHash]);
      return rows[0];
    }
  };
}
