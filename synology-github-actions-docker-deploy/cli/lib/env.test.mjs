import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEnvInstallScript, workflowRunArgs } from './env.mjs';

const config = {
  project: 'ghdeploytest',
  owner: 'kim-geon-admin',
  nas: {
    adminUser: 'nayaguny',
    dir: '/volume1/docker/ghdeploytest'
  }
};

test('uploads env through one password-fed root shell', () => {
  const script = buildEnvInstallScript(config, 'DATA_DIR=/volume1/docker/ghdeploytest/data\n');

  assert.match(script, /\/var\/services\/homes\/nayaguny\/.nas-deploy-upload\/env-file/);
  assert.match(script, /sudo -S -p '' sh -c/);
  assert.doesNotMatch(script, /sudo mkdir|sudo chmod|sudo tee/);
});

test('runs the configured repository workflow instead of the current git remote', () => {
  assert.deepEqual(workflowRunArgs(config), [
    'workflow', 'run', 'deploy.yml', '--repo', 'kim-geon-admin/ghdeploytest'
  ]);
});
