import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEnv, configurationSummary, connectionRoute, routeExamples, validateDeploymentConfig, withDefaults } from './init.mjs';

test('init persists the selected temporary password mode and preserves admin key', () => {
  const config = withDefaults({
    project: 'demo',
    owner: 'owner',
    nas: {
      host: 'nas.example.test',
      adminUser: 'admin',
      adminKey: '~/.ssh/demo_admin',
      passwordMode: 'temporary'
    },
    network: {
      mode: 'reverse-proxy',
      publicUrl: 'https://app.example.com',
      publicPort: 443
    }
  });

  assert.equal(config.nas.passwordMode, 'temporary');
  assert.equal(config.nas.adminKey, '~/.ssh/demo_admin');
  assert.deepEqual(config.network, {
    mode: 'reverse-proxy',
    publicUrl: 'https://app.example.com',
    publicPort: 443,
    bindHost: '127.0.0.1'
  });
  assert.match(connectionRoute({ ...config, hostPort: 3333, containerPort: 3000 }), /https:\/\/app\.example\.com:443.*127\.0\.0\.1:3333.*3000/);
  assert.match(buildEnv({ ...config, hostPort: 3333 }), /HTTP_BIND=127\.0\.0\.1:3333/);
});

test('records the Synology internal IP route without an external URL', () => {
  const config = withDefaults({
    project: 'demo',
    owner: 'owner',
    hostPort: 3333,
    containerPort: 3000,
    network: { mode: 'internal', bindHost: '192.168.0.20' }
  });

  assert.equal(config.network.bindHost, '192.168.0.20');
  assert.equal(config.network.publicUrl, '');
  assert.match(connectionRoute(config), /^192\.168\.0\.20:3333.*3000/);
  assert.match(buildEnv(config), /HTTP_BIND=192\.168\.0\.20:3333/);
});

test('does not assume a NAS directory for a new configuration', () => {
  const config = withDefaults({ project: 'demo', owner: 'owner' });
  assert.equal(config.nas.dir, '');
  assert.throws(() => validateDeploymentConfig(config), /NAS 배포 폴더/);
});

test('explains reverse proxy and internal-only routes separately', () => {
  const examples = routeExamples();
  assert.match(examples.reverseProxy, /나의 도메인:포트번호/);
  assert.match(examples.reverseProxy, /127\.0\.0\.1:Synology Docker 연결 포트/);
  assert.match(examples.internalOnly, /NAS 내부 IP/);
  assert.match(examples.internalOnly, /127\.0\.0\.1은 NAS 자신/);
});

test('shows resolved local key and configured NAS directory in its summary', () => {
  const config = withDefaults({
    project: 'demo',
    owner: 'owner',
    keyPath: '~/.ssh/demo_deploy',
    nas: { host: 'nas.example.test', port: 2233, adminUser: 'admin', deployUser: 'gh-deploy', dir: '/volume2/apps/demo' }
  });
  const summary = configurationSummary(config);
  assert.match(summary, /[\\/]\.ssh[\\/]demo_deploy/);
  assert.match(summary, /\/volume2\/apps\/demo \(nas\.example\.test:2233\)/);
});

test('rejects generic placeholders used as NAS values', () => {
  assert.throws(() => validateDeploymentConfig(withDefaults({
    project: 'demo',
    owner: 'owner',
    keyPath: '~/.ssh/demo_deploy',
    nas: { host: '나의 도메인', adminUser: 'admin', deployUser: 'gh-deploy', dir: '<NAS 배포 폴더>' }
  })), /실제 값/);
});
