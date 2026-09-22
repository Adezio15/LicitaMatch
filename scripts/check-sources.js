import { createPncpSource } from '../src/services/sources/pncpSource.js';
import { createComprasnetSource } from '../src/services/sources/comprasnetSource.js';

// Read-only smoke check. Does not load credentials, persist data or send email.
const dataFinal = process.argv[3] || new Date().toISOString().slice(0,10);
const dataInicial = process.argv[2] || new Date(Date.now()-86400000).toISOString().slice(0,10);
for (const [name,source] of [['pncp',createPncpSource()],['comprasnet',createComprasnetSource()]]) {
  if (process.argv[4] && process.argv[4] !== name) continue;
  try {
    const result = await source.fetchLatest({dataInicial,dataFinal,page:1,pageSize:10});
    console.log(JSON.stringify({source:name,status:'ok',count:result.count,totalPages:result.totalPages,period:{dataInicial,dataFinal}}));
  } catch (error) {
    console.log(JSON.stringify({source:name,status:'failed',reason:error.name,code:error.cause?.code || null}));
    process.exitCode = 1;
  }
}
