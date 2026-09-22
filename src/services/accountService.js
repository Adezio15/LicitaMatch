import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { HttpError } from '../utils/httpError.js';
import { accountRepository } from '../repositories/accountRepository.js';

const rounds = 12;
// Mesmo custo de bcrypt para e-mail inexistente, evitando atalho de timing.
const dummyHash = bcrypt.hash(randomBytes(32).toString('hex'), rounds);
const invalidLogin = () => new HttpError(401, 'E-mail ou senha inválidos');

export function accountService(database) {
  const repository = accountRepository(database);
  return {
    repository,
    async register(data) {
      const hash = await bcrypt.hash(data.senha, rounds);
      return repository.transaction(async transaction => {
        const company = await transaction.createCompany(data);
        const user = await transaction.createUser(company.id, { ...data, tipo: 'gestor' }, hash);
        return { company, user };
      });
    },
    async login(data) {
      const user = await repository.findLogin(data.email);
      const matches = await bcrypt.compare(data.senha, user?.senha_hash || await dummyHash);
      if (!matches || !user?.ativo || user.empresa_status !== 'ativo') throw invalidLogin();
      return user;
    },
    async createUser(empresaId, data) {
      return repository.createUser(empresaId, data, await bcrypt.hash(data.senha, rounds));
    },
    async getDashboard(empresaId) {
      return repository.getDashboard(empresaId);
    },
    async getAdminOverview() {
      return repository.getAdminOverview();
    },
    async updateUser(actor, id, data) {
      if (String(actor.id) === String(id)) throw new HttpError(422, 'Peça a outro gestor para alterar seu cadastro ou sua permissão.');
      return repository.transaction(async transaction => {
        // Impede que dois gestores removam simultaneamente o acesso um do outro.
        await transaction.lockCompany(actor.empresa_id);
        const currentActor = await transaction.findSessionUser(actor.id, actor.empresa_id);
        if (!currentActor?.ativo || !['gestor', 'admin'].includes(currentActor.tipo) || currentActor.empresa_status !== 'ativo') {
          throw new HttpError(403, 'Seu acesso de gestor não está mais ativo');
        }
        const user = await transaction.updateUser(actor.empresa_id, id, data);
        if (!user) throw new HttpError(404, 'Usuário não encontrado');
        return user;
      });
    },
    async changePassword(actor, data) {
      const user = await repository.findLogin(actor.email);
      if (!user || !await bcrypt.compare(data.senha_atual, user.senha_hash)) throw new HttpError(422, 'Senha atual incorreta');
      const updated = await repository.changePassword(actor.empresa_id, actor.id, user.senha_hash, await bcrypt.hash(data.senha, rounds));
      if (!updated) throw new HttpError(409, 'Sua senha foi alterada em outra sessão. Entre novamente.');
    }
  };
}
