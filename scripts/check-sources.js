import { createDefaultSourceRegistry } from '../src/services/sources/defaultSources.js';

// Read-only smoke check. Does not load credentials, persist data or send email.
const dataFinal = process.argv[3] || new Date().toISOString().slice(0,10);
const dataInicial = process.argv[2] || new Date(Date.now()-86400000).toISOString().slice(0,10);
const registry = createDefaultSourceRegistry({ SYNC_ENABLED: 'true', COMPRASNET_ENABLED: 'true' });
const selector = process.argv[4];
const sources = registry.listSources().filter(source => !selector || selector === source.id ||
  (selector === 'senac' && source.name.startsWith('Senac ')) ||
  (selector === 'sesc' && source.name.startsWith('Sesc ')) || (selector === 'recife' && source.id === 'portal-37'));
if (!sources.length) throw new Error('Fonte desconhecida para o teste.');
const pending = sources.values();
async function check() {
  for (const source of pending) {
    const name = source.id;
    try {
      const result = await source.fetchLatest({dataInicial,dataFinal,page:1,pageSize:10});
      console.log(JSON.stringify({source:name,name:source.name,status:'ok',count:result.count,totalPages:result.totalPages,collectionMode:source.collectionMode || 'period',period:{dataInicial,dataFinal}}));
    } catch (error) {
      console.log(JSON.stringify({source:name,status:'failed',reason:error.name,code:error.cause?.code || null}));
      process.exitCode = 1;
    }
  }
}
await Promise.all(Array.from({ length: Math.min(4, sources.length) }, () => check()));
