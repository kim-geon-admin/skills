import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPrepareProbeScript,
  deploymentAccountGuide,
  deploymentAccountState,
  deploymentShareName,
  replaceDeploymentAccount,
  validateDeploymentUserName
} from './prepare.mjs';

const ready = {
  USER: 'ok',
  GROUP: 'ok',
  SHELL: '/bin/sh',
  HOME: 'ok',
  HOMEACCESS: 'ok',
  DEPLOYSHARE: 'ok'
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

test('names the shared folder containing the configured deployment path', () => {
  const config = { nas: { deployUser: 'release-bot', dir: '/volume2/apps/ghdeploytest' } };
  assert.equal(deploymentShareName(config), 'apps');
  assert.match(deploymentAccountGuide(config), /배포 경로가 속한 공유 폴더\(apps\).*읽기 전용/);
});

test('checks Container Manager through its absolute Synology paths', () => {
  const script = buildPrepareProbeScript({
    nas: { deployUser: 'test-deploy', dir: '/volume1/docker/ghdeploytest' }
  });

  assert.match(script, /\/usr\/local\/bin\/docker-compose version/);
  assert.match(script, /\/usr\/local\/bin\/docker compose version/);
  assert.doesNotMatch(script, /sudo docker compose/);
});

test('accepts a safe new deployment account name', () => {
  assert.equal(validateDeploymentUserName('release-bot'), 'release-bot');
  assert.equal(validateDeploymentUserName('deploy_2'), 'deploy_2');
});

test('rejects unsafe or privileged new deployment account names', () => {
  assert.throws(() => validateDeploymentUserName(''), /계정 이름/);
  assert.throws(() => validateDeploymentUserName('release bot'), /계정 이름/);
  assert.throws(() => validateDeploymentUserName('root'), /사용할 수 없습니다/);
});

test('shows account creation and permission registration for the selected name', () => {
  const guide = deploymentAccountGuide({
    nas: { deployUser: 'release-bot', dir: '/volume1/docker/ghdeploytest' }
  });
  assert.match(guide, /release-bot/);
  assert.match(guide, /administrators/);
  assert.match(guide, /homes/);
  assert.match(guide, /읽기 전용/);
});

test('replaces only the deployment account in the saved configuration', () => {
  const config = {
    project: 'demo',
    nas: { deployUser: 'gh-deploy', host: 'nas.example.test', dir: '/volume1/docker/demo' },
    keyPath: '~/.ssh/demo_deploy'
  };
  const next = replaceDeploymentAccount(config, 'release-bot');
  assert.equal(next.nas.deployUser, 'release-bot');
  assert.equal(next.nas.host, config.nas.host);
  assert.equal(next.keyPath, config.keyPath);
  assert.equal(config.nas.deployUser, 'gh-deploy');
});
