export function createCronService({ now = () => Date.now() } = {}) {
  const jobs = new Map();

  const normalizeJob = (name, definition) => {
    if (!definition || typeof definition !== 'object') {
      throw new Error(`Job "${name}" inválido.`);
    }
    if (!definition.run || typeof definition.run !== 'function') {
      throw new Error(`Job "${name}" precisa de uma função run().`);
    }
    const intervalMs = Number(definition.intervalMs ?? 0);
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error(`Job "${name}" precisa de intervalMs > 0.`);
    }

    return {
      name,
      intervalMs,
      nextRunAt: Number.isFinite(Number(definition.nextRunAt)) ? Number(definition.nextRunAt) : now(),
      enabled: definition.enabled !== false,
      run: definition.run
    };
  };

  return {
    register(name, definition) {
      const job = normalizeJob(name, definition);
      jobs.set(String(name), job);
      return job;
    },
    getJob(name) {
      const job = jobs.get(String(name));
      if (!job) throw new Error(`Job "${name}" não encontrado.`);
      return job;
    },
    listJobs() {
      return [...jobs.values()].map(job => ({ ...job }));
    },
    async runDue(referenceTime = now()) {
      const results = [];
      const entries = [...jobs.values()].filter(job => job.enabled && job.nextRunAt <= referenceTime);

      for (const job of entries) {
        if (job.running || job.nextRunAt > referenceTime) continue;
        job.running = true;
        const nextRunAt = Number(reflectionValue(job, referenceTime));
        job.nextRunAt = nextRunAt;
        try {
          const value = await job.run({ job: job.name, at: referenceTime });
          results.push({ name: job.name, result: value, nextRunAt: job.nextRunAt });
        } catch (error) {
          results.push({ name: job.name, error, nextRunAt: job.nextRunAt });
        } finally { job.running = false; }
      }

      return results;
    }
  };
}

function reflectionValue(job, referenceTime) {
  return referenceTime + job.intervalMs;
}
