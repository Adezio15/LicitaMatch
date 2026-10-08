import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../src/app.js';
import { readMigrations } from '../src/services/migrationService.js';
import { parseEnv } from '../src/config/env.js';
import { createLogger } from '../src/utils/logger.js';
import { profileSchemas } from '../src/utils/companyProfile.js';
import { matchLicitacao } from '../src/services/matchesService.js';

const config = parseEnv({ DATABASE_URL:'postgresql://test:test@localhost/test',NODE_ENV:'test',SESSION_SECRET:'profile-test-secret-'.repeat(4) });
const logger = createLogger('silent');
const commercial = { capacidade_quantidade:'100',capacidade_unidade:'caixa',capacidade_periodo:'mes',capacidade_descricao:'',oportunidade_min:'5000',oportunidade_max:'500000',margem_min:'15',entrega_quantidade:'15',entrega_unidade:'dias_uteis' };

test('validações estruturadas do perfil', () => {
  assert.equal(profileSchemas.comercial.safeParse(commercial).success,true);
  for (const changes of [{margem_min:101},{oportunidade_max:100},{entrega_quantidade:-1},{entrega_unidade:''},{capacidade_unidade:''},{oportunidade_min:'NaN'},{entrega_quantidade:1.5},{margem_min:15.123},{capacidade_quantidade:0.0001},{capacidade_quantidade:1e-12},{oportunidade_min:true},{oportunidade_min:[]}]) assert.equal(profileSchemas.comercial.safeParse({...commercial,...changes}).success,false);
  assert.equal(profileSchemas.atividades.safeParse({atividades:[{tipo:'principal',cnae:'123',descricao:'Inválido'}]}).success,false);
  assert.equal(profileSchemas.documentacao.safeParse({documentos:[],certificacoes:[{nome:'ISO',validade:'2026-02-30'}]}).success,false);
  assert.equal(profileSchemas.atendimento.safeParse({atendimento_nacional:false,regioes:[{tipo:'municipio',nome:'Natal'}]}).success,false);
  assert.equal(profileSchemas.atendimento.safeParse({atendimento_nacional:true,regioes:[{tipo:'estado',estado:'RN'}]}).success,false);
});

test('perfil completo: migração preserva dados, persistência, isolamento, permissões e completude', async t => {
  const db = new PGlite();
  const migrations = await readMigrations();
  for (const migration of migrations.filter(m => !m.name.startsWith('015_'))) await db.exec(migration.sql);
  await db.query("INSERT INTO empresas (razao_social,cnpj,email) VALUES ('Legada','12345678000195','legada@example.test')");
  await db.exec(migrations.find(m=>m.name.startsWith('015_')).sql);
  assert.equal((await db.query("SELECT razao_social FROM empresas WHERE cnpj='12345678000195'")).rows[0].razao_social,'Legada');
  const database = { query:(sql,params)=>db.query(sql,params), connect:async()=>({query:(sql,params)=>db.query(sql,params),release(){}}) };
  const app = createApp({config,database,logger});
  const register = async (email,cnpj) => {
    const agent = request.agent(app);
    const csrf = (await agent.get('/api/auth/csrf')).body.csrfToken;
    const response = await agent.post('/api/auth/register').set('X-CSRF-Token',csrf).send({cnpj,razao_social:'Empresa teste',email_empresa:email,nome:'Gestor',email,senha:'Senha-perfil-2026!'}).expect(201);
    return {agent,csrf:response.body.csrfToken,user:response.body.user};
  };
  try {
    const a = await register('perfil-a@example.test','11222333000181');
    const b = await register('perfil-b@example.test','11444777000161');
    const save = (section,data,status=200) => a.agent.patch('/api/empresa/perfil/'+section).set('X-CSRF-Token',a.csrf).send(data).expect(status);
    await t.test('valida CNPJ na edição e impede duplicidade sem perder dados', async()=>{
      const data = {cnpj:'11.222.333/0001-81',razao_social:'Empresa completa',email_empresa:'empresa@example.test',telefone:'84999999999',cidade:'Natal',estado:'RN'};
      await save('empresa',{...data,cnpj:'00000000000000'},422);
      await save('empresa',{...data,cnpj:'11444777000161'},409);
      await save('empresa',data);
      const result = await a.agent.get('/api/empresa/perfil').expect(200);
      assert.equal(result.body.company.cnpj,'11222333000181');
      assert.equal(result.body.completion.percentual,25);
    });
    const activities = [{tipo:'principal',cnae:'47.51-2/01',descricao:'Comércio de informática'},{tipo:'secundario',cnae:'4751202',descricao:'Outra atividade'},{tipo:'efetiva',descricao:'Fornecimento de computadores'}];
    const catalog = {produtos:[{tipo:'produto',nome:'Computador <script>',descricao:'Computador profissional',categoria:'Informática',palavras_chave:['computador','desktop'],especificacoes:'16 GB RAM',unidade:'unidade',capacidade:'100/mês'},{tipo:'servico',nome:'Manutenção',descricao:'Manutenção de computadores',unidade:'serviço'}],marcas:[{marca:'Marca A',fabricante:'Fabricante A',marcas_equivalentes:['Marca B'],produtos_equivalentes:'Modelo similar'}]};
    await t.test('salva todas as seções e calcula 100% com dados reais',async()=>{
      await save('atividades',{atividades:activities});
      await save('catalogo',catalog);
      await save('atendimento',{atendimento_nacional:false,regioes:[{tipo:'estado',estado:'RN'},{tipo:'regiao',nome:'Nordeste'},{tipo:'municipio',estado:'PB',nome:'João Pessoa'}]});
      await save('comercial',commercial);
      await save('documentacao',{documentos:[{tipo:'Atestado de capacidade técnica',observacao:'Disponível'}],certificacoes:[{nome:'ISO',numero:'123',orgao_emissor:'Órgão',validade:'2027-12-31',observacao:'Registro'}]});
      await save('restricoes',{restricoes:[{tipo:'quantidade_minima',descricao:'Pedido mínimo de 10 unidades'}]});
      const {body} = await a.agent.get('/api/empresa/perfil').expect(200);
      assert.equal(body.completion.percentual,100);
      assert.equal(body.profile.atividades[0].cnae,'4751201');
      assert.equal(body.profile.produtos.length,2);
      assert.deepEqual(body.profile.produtos[0].palavras_chave,['computador','desktop']);
      assert.equal(body.profile.certificacoes[0].validade,'2027-12-31');
      assert.equal(Number(body.profile.comercial.margem_min),15);
      assert.equal((await a.agent.get('/conta').expect(200)).text.includes('100% preenchido'),true);
      const page = await a.agent.get('/empresa').expect(200);
      assert.match(page.text,/Computador &lt;script&gt;/);
      assert.match(page.text,/company-profile.js/);
      assert.match(page.text,/data-section="documentacao"/);
    });
    await t.test('não aceita IDs nem permite consultar dados privados de outra empresa',async()=>{
      await save('comercial',{...commercial,empresa_id:b.user.empresa_id},422);
      await save('atividades',{atividades:[{tipo:'efetiva',descricao:'Ataque',id:1}]},422);
      await save('inexistente',{},404);
      await a.agent.patch('/api/empresa/perfil/comercial').send(commercial).expect(403);
      const other = await b.agent.get('/api/empresa/perfil?empresa_id='+a.user.empresa_id).expect(200);
      assert.equal(other.body.profile.comercial.margem_min,null);
      assert.equal(other.body.profile.produtos.length,0);
      await b.agent.get(`/api/admin/empresas/${a.user.empresa_id}/perfil`).expect(403);
      await b.agent.patch(`/api/admin/empresas/${a.user.empresa_id}/perfil/comercial`).set('X-CSRF-Token',b.csrf).send(commercial).expect(403);
    });
    await t.test('edição de uma seção preserva outras, erros preservam registros e exclusão recalcula completude',async()=>{
      const before = (await a.agent.get('/api/empresa/perfil')).body;
      await save('atividades',{atividades:[...activities,{tipo:'principal',cnae:'4751203',descricao:'Duplicado'}]},422);
      assert.deepEqual((await a.agent.get('/api/empresa/perfil')).body.profile.atividades,before.profile.atividades);
      await save('catalogo',{produtos:[catalog.produtos[1]],marcas:[]});
      await save('atendimento',{atendimento_nacional:true,regioes:[]});
      const changed = (await a.agent.get('/api/empresa/perfil')).body;
      assert.equal(changed.profile.produtos.length,1);
      assert.equal(changed.profile.regioes.length,0);
      assert.deepEqual(changed.profile.comercial,before.profile.comercial);
      await save('documentacao',{documentos:[],certificacoes:[]});
      assert.equal((await a.agent.get('/api/empresa/perfil')).body.completion.percentual,92);
    });
    await t.test('usuário comum consulta a própria empresa mas não edita; admin acessa perfil autorizado',async()=>{
      await db.query("UPDATE usuarios SET tipo='usuario' WHERE id=$1",[b.user.id]);
      await b.agent.get('/empresa').expect(200);
      await b.agent.patch('/api/empresa/perfil/comercial').set('X-CSRF-Token',b.csrf).send(commercial).expect(403);
      await db.query("UPDATE usuarios SET tipo='admin' WHERE id=$1",[b.user.id]);
      const result = await b.agent.get(`/api/admin/empresas/${a.user.empresa_id}/perfil`).expect(200);
      assert.equal(Number(result.body.profile.comercial.margem_min),15);
      await b.agent.get(`/admin/empresas/${a.user.empresa_id}/perfil`).expect(200);
      await b.agent.patch(`/api/admin/empresas/${a.user.empresa_id}/perfil/restricoes`).set('X-CSRF-Token',b.csrf).send({restricoes:[]}).expect(200);
    });
    await t.test('dados novos não alimentam interesses nem matches',async()=>{
      assert.equal((await db.query('SELECT count(*)::int AS total FROM interesses')).rows[0].total,0);
      assert.equal((await db.query('SELECT count(*)::int AS total FROM matches')).rows[0].total,0);
      assert.equal(matchLicitacao({objeto:'Compra de computador'}, {palavras:['computador','desktop','manutenção']}),33);
    });
  } finally { await app.locals.sessionStore.close(); await db.close(); }
});
