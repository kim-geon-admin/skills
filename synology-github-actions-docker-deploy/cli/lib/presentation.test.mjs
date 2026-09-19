import test from 'node:test';
import assert from 'node:assert/strict';
import { keySummary } from './key.mjs';
import { nasInstallSummary } from './nas.mjs';
import { secretPreview } from './secrets.mjs';
import { withDefaults } from './init.mjs';

const config = withDefaults({
  project: 'demo',
  owner: 'owner',
  keyPath: '~/.ssh/demo_deploy',
  nas: {
    host: 'nas.example.test',
    port: 2233,
    adminUser: 'admin',
    deployUser: 'release-bot',
    dir: '/volume2/apps/demo'
  }
});

test('key summary shows the resolved key path and selected NAS account', () => {
  const summary = keySummary(config);
  assert.match(summary, /[\\/]\.ssh[\\/]demo_deploy/);
  assert.match(summary, /release-bot/);
});

test('NAS install summary shows configured directory and SSH endpoint', () => {
  const summary = nasInstallSummary(config);
  assert.match(summary, /\/volume2\/apps\/demo/);
  assert.match(summary, /nas\.example\.test:2233/);
});

test('secret preview shows identifiers and local paths without secret contents', () => {
  const preview = secretPreview(config);
  assert.deepEqual(preview, {
    NAS_SSH_HOST: 'nas.example.test',
    NAS_SSH_PORT: '2233',
    NAS_SSH_USER: 'release-bot',
    NAS_SSH_PRIVATE_KEY: expectPath(preview.NAS_SSH_PRIVATE_KEY, 'demo_deploy'),
    NAS_SSH_KNOWN_HOSTS: expectPath(preview.NAS_SSH_KNOWN_HOSTS, 'demo_known_hosts')
  });
  assert.doesNotMatch(JSON.stringify(preview), /BEGIN (OPENSSH|RSA) PRIVATE KEY/);
});

function expectPath(value, suffix) {
  assert.ok(value.endsWith(suffix), `${value} should end with ${suffix}`);
  return value;
}
