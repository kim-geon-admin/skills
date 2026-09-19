import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCleanupScript } from './cleanup.mjs';

const config = {
  project: 'ghdeploytest',
  nas: {
    adminUser: 'nayaguny',
    deployUser: 'gh-deploy',
    dir: '/volume1/docker/ghdeploytest'
  }
};

test('removes only this project deployment access and files', () => {
  const script = buildCleanupScript(config);

  assert.match(script, /github-actions@ghdeploytest/);
  assert.match(script, /authorized_keys/);
  assert.match(script, /etc\/sudoers\.d\/ghdeploytest-deploy/);
  assert.match(script, /docker-compose/);
  assert.match(script, /deploy\.sh/);
  assert.match(script, /sudo -p '' sh -c/);
  assert.doesNotMatch(script, /sudo -S/);
  assert.doesNotMatch(script, /\/data(?:['\/]|\s)/);
  assert.doesNotMatch(script, /\/cache(?:['\/]|\s)/);
  assert.doesNotMatch(script, /rm -rf \/volume1\/docker\/ghdeploytest\s*$/m);
  assert.doesNotMatch(script, /authorized_keys.*cat|cat.*authorized_keys/);
});
