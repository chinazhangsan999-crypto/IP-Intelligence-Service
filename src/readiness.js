export function createReadiness(providers = []) {
  const states = new Map(providers.map((provider) => [provider.id, { ...provider }]));

  return Object.freeze({
    set(id, state) {
      if (!id || typeof id !== 'string') throw new Error('Readiness source id is required');
      states.set(id, { id, ...states.get(id), ...state });
    },
    snapshot() {
      const currentProviders = [...states.values()];
      const requiredProviders = currentProviders.filter((provider) => provider.required === true);
      const sources = currentProviders.map((provider) => ({
        id: provider.id,
        required: provider.required === true,
        ready: provider.ready === true,
        status: provider.status || (provider.ready === true ? 'ready' : 'unavailable'),
        version: provider.version || null,
        updated_at: provider.updated_at || null,
        expires_at: provider.expires_at || null,
        message: provider.message || null,
      }));
      const requiredSourcesReady = requiredProviders.length > 0
        && requiredProviders.every((provider) => provider.ready === true);

      return {
        required_sources_ready: requiredSourcesReady,
        sources,
      };
    },
  });
}
