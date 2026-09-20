import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInstallScript } from './nas.mjs';

const config = {
  project: 'ghdeploytest',
  nas: {
    adminUser: 'nayaguny',
    deployUser: 'gh-deploy',
    dir: '/volume1/docker/ghdeploytest'
  }
};

test('builds NAS installation for one password-fed root shell', () => {
  const script = buildInstallScript(config, {
    'deploy.sh': '# deploy',
    'deploy-gate.sh': '# gate',
    'compose.yaml': 'services: {}'
  }, 'APP_MESSAGE=hello\n');

  assert.doesNotMatch(script, /sudo -S -p '' sh -c/);
  assert.match(script, /\/var\/services\/homes\/nayaguny\/.nas-deploy-upload\/deploy\.sh/);
  assert.match(script, /install -o root -g root -m 700/);
  assert.match(script, /echo "ENVMODE=\$\(stat -c %a [^\n]+ \|\| echo none\)"/);
  assert.doesNotMatch(script, /\$HOME\/\.nas-deploy-upload|\/root\/\.nas-deploy-upload/);
  assert.doesNotMatch(script, /sudo mkdir|sudo install|sudo chmod|sudo tee/);
});
