import test from 'node:test';
import assert from 'node:assert/strict';
import { githubRepo, repoViewArgs, secretListArgs, secretSetArgs } from './secrets.mjs';

const config = { owner: 'kim-geon-admin', project: 'ghdeploytest' };

test('targets the configured GitHub repository for every secret operation', () => {
  assert.equal(githubRepo(config), 'kim-geon-admin/ghdeploytest');
  assert.deepEqual(secretSetArgs(config, 'NAS_SSH_HOST'), [
    'secret', 'set', 'NAS_SSH_HOST', '--repo', 'kim-geon-admin/ghdeploytest'
  ]);
  assert.deepEqual(secretListArgs(config), [
    'secret', 'list', '--repo', 'kim-geon-admin/ghdeploytest'
  ]);
  assert.deepEqual(repoViewArgs(config), [
    'repo', 'view', '--repo', 'kim-geon-admin/ghdeploytest', '--json', 'nameWithOwner,visibility',
    '--jq', '.nameWithOwner + " (" + .visibility + ")"'
  ]);
});
