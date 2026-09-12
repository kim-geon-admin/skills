import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInstallScript } from './nas.mjs';

const config = {
  project: 'ghdeploytest',
  nas: {
    deployUser: 'gh-deploy',
    dir: '/volume1/docker/ghdeploytest'
  }
};

test('builds NAS installation as one password-fed root shell', () => {
  const script = buildInstallScript(config, {
    'deploy.sh': '# deploy',
    'deploy-gate.sh': '# gate',
    'compose.yaml': 'services: {}'
  }, 'APP_MESSAGE=hello\n');

  assert.match(script, /sudo -S -p '' sh -c/);
  assert.doesNotMatch(script, /sudo mkdir|sudo install|sudo chmod|sudo tee/);
});
