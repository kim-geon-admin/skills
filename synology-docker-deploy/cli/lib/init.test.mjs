import test from 'node:test';
import assert from 'node:assert/strict';
import { withDefaults } from './init.mjs';

test('init persists the selected temporary password mode and preserves admin key', () => {
  const config = withDefaults({
    project: 'demo',
    owner: 'owner',
    nas: {
      host: 'nas.example.test',
      adminUser: 'admin',
      adminKey: '~/.ssh/demo_admin',
      passwordMode: 'temporary'
    }
  });

  assert.equal(config.nas.passwordMode, 'temporary');
  assert.equal(config.nas.adminKey, '~/.ssh/demo_admin');
});
