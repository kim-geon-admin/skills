import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('help exposes the password-managed session command', () => {
  const result = spawnSync(process.execPath, ['nas-deploy.mjs', 'help'], {
    cwd: new URL('.', import.meta.url),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /session/);
});
