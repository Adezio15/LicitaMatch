import portals from './portalCatalog.json' with { type: 'json' };
import { createSourceRegistry } from './sourceRegistry.js';
import { createPncpSource } from './pncpSource.js';
import { createComprasnetSource } from './comprasnetSource.js';
import { createSenacSource } from './senacSource.js';
import { createRecifeSource } from './recifeSource.js';
import { createSescSource } from './sescSource.js';

export function createDefaultSourceRegistry(config, { fetchImpl = globalThis.fetch } = {}) {
  const sync = config.SYNC_ENABLED === 'true';
  const registry = createSourceRegistry({
    pncp: { ...createPncpSource({ fetchImpl }), name: 'PNCP', enabled: sync },
    comprasnet: { ...createComprasnetSource({ fetchImpl }), name: 'Compras.gov.br', enabled: sync && config.COMPRASNET_ENABLED === 'true' },
    'portal-37': { ...createRecifeSource({ fetchImpl }), enabled: sync && config.RECIFE_ENABLED !== 'false' }
  });
  for (const portal of portals.filter(source => source.name.startsWith('Senac '))) {
    registry.register(portal.id, { ...createSenacSource({ id: portal.id, regional: portal.name.split(' ')[1], fetchImpl }),
      enabled: sync && config.SENAC_ENABLED !== 'false' });
  }
  for (const portal of portals.filter(source => source.name.startsWith('Sesc '))) {
    registry.register(portal.id, { ...createSescSource({ id: portal.id, regional: portal.name.split(' ')[1], fetchImpl }),
      enabled: sync && config.SESC_ENABLED !== 'false' });
  }
  return registry;
}

export function sourceTaskDefinitions(registry, config) {
  return registry.listSources().flatMap(source => {
    const values = source.id === 'pncp' ? config.PNCP_MODALIDADES :
      source.id === 'comprasnet' ? config.COMPRASNET_MODALIDADES : null;
    return values ? [...new Set(values.split(','))].map(modalidade => ({
      name: `sync:${source.id}:${modalidade}`, source: source.id, modalidade
    })) : [{ name: `sync:${source.id}`, source: source.id }];
  });
}
