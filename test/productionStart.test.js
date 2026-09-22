import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('npm start migra e valida antes do servidor; falhas interrompem a sequência', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'licitamatch-start-'));
  try {
    mkdirSync(join(cwd, 'src'));
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({
      private: true,
      scripts: { start: scripts.start, 'db:migrate': 'node migrate.cjs', 'db:check': 'node check.cjs' }
    }));
    writeFileSync(join(cwd, 'migrate.cjs'), "console.log('STEP:migrate'); process.exitCode = process.env.FAIL_STEP === 'migrate' ? 1 : 0;");
    writeFileSync(join(cwd, 'check.cjs'), "console.log('STEP:check'); process.exitCode = process.env.FAIL_STEP === 'check' ? 1 : 0;");
    writeFileSync(join(cwd, 'src/server.js'), "console.log('STEP:server');");
    for (const [failure, expected] of [
      ['', ['STEP:migrate', 'STEP:check', 'STEP:server']],
      ['migrate', ['STEP:migrate']],
      ['check', ['STEP:migrate', 'STEP:check']]
    ]) {
      const result = spawnSync(process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd start --silent'] : ['start', '--silent'], {
        cwd, encoding: 'utf8', timeout: 30000,
        env: { ...process.env, NODE_ENV: 'production', FAIL_STEP: failure }
      });
      assert.ifError(result.error);
      assert.equal(result.status, failure ? 1 : 0, result.stderr);
      assert.deepEqual(result.stdout.split(/\r?\n/).filter(line => line.startsWith('STEP:')), expected);
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
