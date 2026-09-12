import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEnv, connectionRoute, withDefaults } from './init.mjs';

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
