import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildEnv, configurationSummary, connectionRoute, confirmStoredConfig, normalizePublicEndpoint, routeExamples, validateDeploymentConfig, withDefaults } from './init.mjs';

test('accepts a port in the external URL without duplicating it in the route', () => {
  assert.deepEqual(normalizePublicEndpoint('https://example.synology.me:1001', 443), {
    publicUrl: 'https://example.synology.me',
    publicPort: 1001
  });

  const config = withDefaults({
    project: 'demo',
    owner: 'owner',
    network: { mode: 'reverse-proxy', publicUrl: 'https://example.synology.me:1001' }
  });
  assert.equal(config.network.publicPort, 1001);
  assert.doesNotMatch(connectionRoute(config), /1001:443/);
});

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
  assert.equal(config.nas.port, 0);
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

test('rejects a missing or invalid SSH port', () => {
  const base = {
    project: 'demo',
    owner: 'owner',
    keyPath: '~/.ssh/demo_deploy',
    nas: { host: 'nas.internal', adminUser: 'admin', deployUser: 'gh-deploy', dir: '/volume2/apps/demo' }
  };
  assert.throws(() => validateDeploymentConfig(withDefaults(base)), /SSH 포트/);
  assert.throws(() => validateDeploymentConfig(withDefaults({ ...base, nas: { ...base.nas, port: 70000 } })), /SSH 포트/);
});

test('does not embed a project-specific NAS endpoint in init prompts', () => {
  const source = fs.readFileSync(new URL('./init.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /nayaguny\.synology\.me/);
  assert.doesNotMatch(source, /2233/);
});

test('asks whether to use an existing config before continuing', async () => {
  const input = {
    project: 'demo',
    owner: 'owner',
    keyPath: '~/.ssh/demo_deploy',
    nas: { host: 'nas.example.test', port: 22, adminUser: 'admin', deployUser: 'gh-deploy', dir: '/volume2/apps/demo' }
  };

  const accept = { question: async () => 'y' };
  const selected = await confirmStoredConfig(accept, input);
  assert.equal(selected.nas.host, 'nas.example.test');
  assert.equal(selected.nas.port, 22);

  const reject = { question: async () => 'n' };
  assert.equal(await confirmStoredConfig(reject, input), null);
});
