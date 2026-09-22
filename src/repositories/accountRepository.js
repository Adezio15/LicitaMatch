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
    async listCompanies() {
      const { rows } = await database.query(`SELECT e.*,
        (SELECT count(*)::int FROM usuarios u WHERE u.empresa_id=e.id AND u.ativo=true) AS usuarios_ativos,
        (SELECT count(*)::int FROM interesses i WHERE i.empresa_id=e.id AND i.ativo=true) AS interesses_ativos,
        (SELECT count(*)::int FROM matches m WHERE m.empresa_id=e.id) AS oportunidades_totais
        FROM empresas e
        ORDER BY e.created_at DESC`);
      return rows;
    },
    async getAdminOverview() {
      const { rows: summaryRows } = await database.query(`SELECT
        count(*)::int AS empresas_totais,
        count(*) FILTER (WHERE status = 'ativo')::int AS empresas_ativas,
        (SELECT count(*)::int FROM usuarios WHERE ativo=true) AS usuarios_ativos,
        (SELECT count(*)::int FROM interesses WHERE ativo=true) AS interesses_ativos
        FROM empresas`);
      const empresas = await this.listCompanies();
      return { summary: summaryRows[0] || {}, empresas };
    },
    async getDashboard(empresaId) {
      const { rows: summaryRows } = await database.query(`SELECT
        (SELECT count(*)::int FROM interesses WHERE empresa_id=$1 AND ativo=true) AS interesses_ativos,
        (SELECT count(*)::int FROM matches WHERE empresa_id=$1) AS oportunidades_totais,
        (SELECT COALESCE(max(score), 0)::int FROM matches WHERE empresa_id=$1) AS maior_score,
        (SELECT count(*)::int FROM usuarios WHERE empresa_id=$1 AND ativo=true) AS usuarios_ativos`, [empresaId]);
      const { rows: matchesRows } = await database.query(`SELECT m.id, m.score, m.status, m.empresa_id,
        i.titulo AS interesse_titulo, l.objeto, l.modalidade, l.unidade_gestora, m.created_at
        FROM matches m
        JOIN interesses i ON i.id = m.interesse_id
        JOIN licitacoes_pncp l ON l.id = m.licitacao_id
        WHERE m.empresa_id=$1
        ORDER BY m.score DESC, m.created_at DESC LIMIT 5`, [empresaId]);
      return { ...(summaryRows[0] || {}), topMatches: matchesRows };
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
