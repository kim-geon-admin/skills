import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseDeploymentAccount } from './key.mjs';

const config = {
  project: 'demo',
  nas: {
    host: 'nas.example.test',
    port: 22,
    deployUser: 'gh-deploy',
    dir: '/volume2/apps/demo'
  }
};

const reader = (...answers) => ({
  question: async () => answers.shift() ?? ''
});

test('keeps the configured deployment account when confirmed', async () => {
  const selected = await chooseDeploymentAccount(reader('y'), config);
  assert.equal(selected, config);
});

test('offers new account setup instead of skipping when the configured account is rejected', async () => {
  const selected = await chooseDeploymentAccount(reader('n', 'y', 'gh-deploy-new', 'y'), config);
  assert.equal(selected.nas.deployUser, 'gh-deploy-new');
});

test('stops without changing the account when new account setup is declined', async () => {
  assert.equal(await chooseDeploymentAccount(reader('n', 'n'), config), null);
});
