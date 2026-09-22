export function createSourceRegistry(initialSources = {}) {
  const sources = new Map();

  const canonicalize = (id, source) => {
    if (!source || typeof source !== 'object') {
      throw new Error(`Fonte inválida para ${id}`);
    }
    const descriptor = {
      id: String(source.id ?? id),
      name: String(source.name ?? source.id ?? id),
      enabled: source.enabled !== false,
      ...source,
    };
    if (!descriptor.fetchLatest || typeof descriptor.fetchLatest !== 'function') {
      throw new Error(`Fonte "${descriptor.id}" não expõe fetchLatest()`);
    }
    return descriptor;
  };

  for (const [id, source] of Object.entries(initialSources)) {
    const descriptor = canonicalize(id, source);
    sources.set(descriptor.id, descriptor);
  }

  return {
    register(id, source) {
      const descriptor = canonicalize(id, source);
      sources.set(descriptor.id, descriptor);
      return descriptor;
    },
    getSource(id) {
      const found = sources.get(String(id));
      if (!found) {
        throw new Error(`Fonte "${id}" não encontrada.`);
      }
      return found;
    },
    listSources(includeDisabled = false) {
      const values = [...sources.values()].filter(source => includeDisabled || source.enabled !== false);
      return values.sort((a, b) => a.name.localeCompare(b.name));
    },
    listSourceIds(includeDisabled = false) {
      return this.listSources(includeDisabled).map(source => source.id);
    },
    async fetch(id, query = {}) {
      const source = this.getSource(id);
      return source.fetchLatest(query);
    }
  };
}
