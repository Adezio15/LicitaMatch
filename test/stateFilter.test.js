import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readMigrations } from '../src/services/migrationService.js';
import { filterSchema, opportunityService } from '../src/services/opportunityService.js';
import { listPortalSources } from '../src/services/sources/portalCatalog.js';
import { createSourceRegistry } from '../src/services/sources/sourceRegistry.js';
import ejs from 'ejs';

test('state filter accepts one or several valid states and rejects invalid input', () => {
  assert.deepEqual(filterSchema.parse({}).uf, []);
  assert.deepEqual(filterSchema.parse({ uf: '' }).uf, []);
  assert.deepEqual(filterSchema.parse({ uf: 'RN' }).uf, ['RN']);
  assert.deepEqual(filterSchema.parse({ uf: ['RN', 'PB', 'RN'] }).uf, ['RN', 'PB']);
  assert.equal(filterSchema.safeParse({ uf: ['RN', 'XX'] }).success, false);
  assert.equal(filterSchema.safeParse({ uf: { bad: 'RN' } }).success, false);
});

test('spreadsheet sources are unique and pending portals cannot appear enabled', () => {
  const sources = listPortalSources(createSourceRegistry({ pncp: {
    name: 'PNCP', enabled: true, async fetchLatest() { return { items: [] }; }
  } }));
  assert.equal(sources.length, 104);
  assert.equal(new Set(sources.map(source => source.id)).size, 104);
  assert.equal(sources.find(source => source.id === 'pncp').enabled, true);
  assert.ok(sources.filter(source => source.id !== 'pncp').every(source => !source.enabled && !source.integrated));
  assert.equal(sources.filter(source => !source.url).length, 0);
});

test('search and opportunities filter states before counting and pagination', async () => {
  const db = new PGlite();
  try {
    for (const migration of await readMigrations()) await db.exec(migration.sql);
    await db.exec(`INSERT INTO empresas (razao_social,cnpj,email,plano)
      VALUES ('Empresa','11222333000181','states@example.test','premium');
      INSERT INTO interesses (empresa_id,titulo,palavras) VALUES (1,'Notebooks',ARRAY['notebook']);
      INSERT INTO licitacoes_pncp (codigo_externo,objeto,data_abertura,unidade_gestora,modalidade,uf)
      SELECT 'states-'||n,'Notebook '||n,now(),'Secretaria','Pregão Eletrônico',
        CASE WHEN n<=21 THEN 'RN' WHEN n=22 THEN 'PB' WHEN n=23 THEN 'SP' ELSE NULL END
      FROM generate_series(1,24) n;
      INSERT INTO matches (empresa_id,interesse_id,licitacao_id,score)
      SELECT 1,1,id,100 FROM licitacoes_pncp;`);
    const service = opportunityService(db);
    for (const method of ['search', 'list']) {
      const all = await service[method](1, filterSchema.parse({}));
      assert.equal(all.total, 24);
      const one = await service[method](1, filterSchema.parse({ uf: 'RN', page: 2 }));
      assert.equal(one.total, 21);
      assert.equal(one.pages, 2);
      assert.equal(one.items.length, 1);
      assert.ok(one.items.every(item => item.uf === 'RN'));
      const multiple = await service[method](1, filterSchema.parse({ uf: ['PB', 'SP'] }));
      assert.equal(multiple.total, 2);
      assert.deepEqual(multiple.items.map(item => item.uf).sort(), ['PB', 'SP']);
      assert.equal((await service[method](1, filterSchema.parse({ uf: 'AC' }))).total, 0);
    }
    for (const view of ['search', 'opportunities']) {
      const html = await ejs.renderFile(`src/views/account/${view}.ejs`, {
        title: 'Busca', user: { plano: 'premium', tipo: 'gestor', razao_social: 'Empresa', nome: 'Gestor' },
        currentPath: '/busca', csrfToken: 'test', states: ['RN', 'PB'], interests: [],
        items: [], total: 21, pages: 2, filters: filterSchema.parse({ uf: ['RN', 'PB'] })
      });
      assert.match(html, /name="uf" value="RN" checked/);
      assert.match(html, /uf=RN&amp;uf=PB&amp;modalidade=&amp;page=2/);
    }
  } finally { await db.close(); }
});

test('modality filters combine with UF in search and matches', async () => {
  assert.equal(filterSchema.safeParse({modalidade:'invalid'}).success, false);
  const db = new PGlite();
  try {
    for (const migration of await readMigrations()) await db.exec(migration.sql);
    await db.exec(`INSERT INTO empresas (razao_social,cnpj,email,plano) VALUES ('Empresa','11222333000181','modal@example.test','premium');
      INSERT INTO interesses (empresa_id,titulo,palavras) VALUES (1,'Notebooks',ARRAY['notebook']);
      INSERT INTO licitacoes_pncp (codigo_externo,objeto,data_abertura,unidade_gestora,modalidade,uf) VALUES
      ('M1','Notebook 1',now(),'Secretaria','Pregão - Presencial','SP'),
      ('M2','Notebook 2',now(),'Secretaria','Pregão Eletrônico','SP'),
      ('M3','Notebook 3',now(),'Secretaria','Dispensa de Licitação','SP'),
      ('M4','Notebook 4',now(),'Secretaria','Dispensa','PB');
      INSERT INTO matches (empresa_id,interesse_id,licitacao_id,score) SELECT 1,1,id,100 FROM licitacoes_pncp;`);
    for (const method of ['search','list']) {
      for (const [modalidade, code] of [['pregao presencial','M1'],['pregao eletronico','M2'],['dispensa','M3']]) {
        const result = await opportunityService(db)[method](1, filterSchema.parse({uf:'SP',modalidade}));
        assert.equal(result.total,1);
        assert.equal(result.items[0].codigo_externo,code);
      }
      assert.equal((await opportunityService(db)[method](1,filterSchema.parse({modalidade:'dispensa'}))).total,2);
    }
  } finally { await db.close(); }
});
