import portals from './portalCatalog.json' with { type: 'json' };

// Spreadsheet links are portal pages, not API endpoints. Only registered
// connectors can be reported as integrated or enabled.
export function listPortalSources(registry) {
  const registered = registry.listSources(true);
  const catalog = portals.map(portal => {
    const connector = registered.find(source => source.id === portal.id);
    return { ...portal, enabled: Boolean(connector?.enabled), integrated: Boolean(connector),
      collectionMode: connector?.collectionMode };
  });
  for (const source of registered) {
    if (!catalog.some(portal => portal.id === source.id)) {
      catalog.push({ id: source.id, name: source.name, enabled: source.enabled, integrated: true });
    }
  }
  return catalog;
}
