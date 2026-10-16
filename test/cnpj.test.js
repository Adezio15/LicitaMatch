import test from 'node:test';
import assert from 'node:assert/strict';
import { cnpjSchema, validCnpj, registerSchema } from '../src/utils/validation.js';
import { cnpjService } from '../src/services/cnpjService.js';

const cnpj = '11222333000181';
const payload = { cnpj, razao_social:' Empresa teste ', nome_fantasia:'Fantasia', descricao_situacao_cadastral:'ATIVA', municipio:'Natal', uf:'RN', cep:'59000-000', logradouro:'Rua A', descricao_tipo_de_logradouro:'RUA', numero:'1', cnae_fiscal:4751201, cnae_fiscal_descricao:'Comércio', ddd_telefone_1:'84999999999' };
const response = (status = 200, data = payload) => ({ status, ok: status === 200, json: async () => data });

test('CNPJ numérico e alfanumérico: formato, normalização e dígitos oficiais', () => {
  assert.equal(cnpjSchema.parse('11.222.333/0001-81'), cnpj);
  assert.equal(cnpjSchema.parse('12.abc.345/01de-35'), '12ABC34501DE35');
  assert.equal(validCnpj('12ABC34501DE35'), true);
  for (const value of ['00000000000000','11111111111111','12ABC34501DE36','12ABC34501DEAB','11 222333000181','11!222333000181','11222333000181extra']) assert.equal(cnpjSchema.safeParse(value).success, false, value);
  assert.equal(registerSchema.safeParse({cnpj:'12ABC34501DE35',razao_social:'Empresa',email_empresa:'empresa@example.test',nome:'Gestor',email:'gestor@example.test',senha:'Senha-segura-1234'}).success,true);
});

test('normaliza, deduplica consultas, usa cache e expira sem consultar o banco', async () => {
  let calls = 0;
  let now = 0;
  const service = cnpjService({ now:()=>now, ttlMs:100, fetchImpl:async (url, options)=>{
    calls++;
    assert.equal(url, `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
    assert.ok(options.signal);
    return response();
  } });
  const [a,b] = await Promise.all([service.lookup(cnpj),service.lookup('11.222.333/0001-81')]);
  assert.equal(calls,1);
  assert.deepEqual(a,b);
  assert.equal(a.razao_social,'Empresa teste');
  assert.equal(a.cep,'59000000');
  assert.equal(a.cnae_principal,'4751201');
  assert.equal(a.situacao_cadastral,'ATIVA');
  assert.equal((await service.lookup(cnpj)).cached,true);
  now=101;
  await service.lookup(cnpj);
  assert.equal(calls,2);
});

test('valida antes de consultar, distingue erros e não armazena falhas em cache', async () => {
  for (const [status,expected] of [[404,404],[429,429],[400,422],[500,502]]) {
    let calls=0;
    const service=cnpjService({fetchImpl:async()=>{calls++;return response(status);}});
    await assert.rejects(service.lookup('00000000000000'),{status:422});
    assert.equal(calls,0);
    await assert.rejects(service.lookup(cnpj),{status:expected});
    await assert.rejects(service.lookup(cnpj),{status:expected});
    assert.equal(calls,2);
  }
  for (const data of [null,{}, {...payload,cnpj:'11444777000161'}, {...payload,razao_social:''}]) {
    await assert.rejects(cnpjService({fetchImpl:async()=>response(200,data)}).lookup(cnpj),{status:502});
  }
  await assert.rejects(cnpjService({fetchImpl:async()=>{throw new Error('network');}}).lookup(cnpj),{status:502});
});

test('timeout e limite de consultas simultâneas', async () => {
  const service = cnpjService({timeoutMs:10,maxConcurrent:1,fetchImpl:()=>new Promise(()=>{})});
  const first = service.lookup(cnpj);
  await assert.rejects(service.lookup('11444777000161'),{status:429});
  await assert.rejects(first,{status:504});
});

test('cache tem tamanho limitado', async () => {
  let calls=0;
  const service=cnpjService({maxEntries:1,fetchImpl:async url=>{calls++;return response(200,{...payload,cnpj:url.split('/').at(-1)});}});
  await service.lookup(cnpj);
  await service.lookup('11444777000161');
  await service.lookup(cnpj);
  assert.equal(calls,3);
});

test('formulário preserva edições locais e exige confirmação para perfil salvo', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const source = await readFile(new URL('../src/public/cnpj-lookup.js', import.meta.url), 'utf8');
  async function setup(existing = false, confirm = true) {
    const listeners = {};
    const controls = Object.fromEntries(['cnpj','razao_social','cidade'].map(name => [name, {value: name === 'cnpj' ? cnpj : name === 'razao_social' ? 'Digitada pelo usuário' : '', addEventListener(type,fn){listeners[name+type]=fn;},dispatchEvent(){}}]));
    const status = {textContent:''};
    const button = {disabled:false,addEventListener(type,fn){listeners.click=fn;}};
    const form = {dataset: existing ? {section:'empresa'} : {}, elements:{_csrf:{value:'token'}},addEventListener(type,fn){listeners[type]=fn;},querySelector(selector){ if(selector==='[data-cnpj-lookup]')return button;if(selector==='[data-cnpj-status]')return status;return controls[selector.match(/name="([^"]+)"/)[1]];}};
    let resolve;
    runInNewContext(source,{document:{querySelectorAll:()=>[form]},window:{confirm:()=>confirm},AbortSignal,Event,fetch:()=>new Promise(r=>{resolve=r;})});
    return {controls,status,listeners,resolve:()=>resolve({ok:true,json:async()=>({razao_social:'Consulta externa',cidade:'Natal'})})};
  }
  const registration = await setup();
  let pending = registration.listeners.click();registration.resolve();await pending;
  assert.equal(registration.controls.razao_social.value,'Digitada pelo usuário');
  assert.equal(registration.controls.cidade.value,'Natal');
  const rejected = await setup(true,false);
  pending=rejected.listeners.click();rejected.resolve();await pending;
  assert.equal(rejected.controls.cidade.value,'');
  assert.equal(rejected.controls.razao_social.value,'Digitada pelo usuário');
  const stale=await setup();
  pending=stale.listeners.click();stale.listeners.input();stale.resolve();await pending;
  assert.equal(stale.controls.cidade.value,'');
  assert.match(stale.status.textContent,/formulário mudou/);
  const accepted=await setup(true,true);
  pending=accepted.listeners.click();accepted.resolve();await pending;
  assert.equal(accepted.controls.razao_social.value,'Consulta externa');
});
