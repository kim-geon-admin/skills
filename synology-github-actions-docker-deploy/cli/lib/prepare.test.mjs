import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrepareProbeScript, deploymentAccountGuide, deploymentAccountState } from './prepare.mjs';

const ready = {
  USER: 'ok',
  GROUP: 'ok',
  SHELL: '/bin/sh',
  HOME: 'ok',
  HOMEACCESS: 'ok',
  DOCKERSHARE: 'ok'
};

test('classifies an existing deployment account with all required access as ready', () => {
  assert.equal(deploymentAccountState(ready), 'ready');
});

test('classifies a missing deployment account separately', () => {
  assert.equal(deploymentAccountState({ ...ready, USER: 'missing' }), 'missing');
});

test('classifies an existing account without administrators membership as incomplete', () => {
  assert.equal(deploymentAccountState({ ...ready, GROUP: 'no' }), 'incomplete');
});

test('shows the exact selected account and DSM creation path', () => {
  const guide = deploymentAccountGuide({ nas: { deployUser: 'release-bot' } });
  assert.match(guide, /제어판.*사용자 및 그룹/);
  assert.match(guide, /release-bot/);
});

test('checks Container Manager through its absolute Synology paths', () => {
  const script = buildPrepareProbeScript({
    nas: { deployUser: 'test-deploy', dir: '/volume1/docker/ghdeploytest' }
  });

  assert.match(script, /\/usr\/local\/bin\/docker-compose version/);
  assert.match(script, /\/usr\/local\/bin\/docker compose version/);
  assert.doesNotMatch(script, /sudo docker compose/);
});
