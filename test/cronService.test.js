import assert from 'node:assert/strict';
import test from 'node:test';
import { createCronService } from '../src/services/cronService.js';

test('createCronService executa jobs vencidos e agenda próxima execução', async () => {
  const seen = [];
  const service = createCronService({ now: () => 1_000 });
  service.register('pncp-sync', {
    intervalMs: 5_000,
    nextRunAt: 0,
    async run() {
      seen.push('pncp-sync');
      return { ok: true };
    }
  });

  const result = await service.runDue();
  assert.equal(result.length, 1);
  assert.deepEqual(seen, ['pncp-sync']);
  assert.equal(service.getJob('pncp-sync').nextRunAt, 6_000);

  const pending = await service.runDue();
  assert.deepEqual(pending, []);
});

test('createCronService rejeita jobs inválidos e lista apenas registros ativos', () => {
  const service = createCronService({ now: () => 1_000 });
  assert.throws(() => service.register('bad', { intervalMs: 0, nextRunAt: 0, run: null }), /interval|run/i);

  service.register('demo', {
    intervalMs: 10_000,
    nextRunAt: 1_500,
    run: async () => ({ ok: true })
  });

  const jobs = service.listJobs();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].name, 'demo');
});
