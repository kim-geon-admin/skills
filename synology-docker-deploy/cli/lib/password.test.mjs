import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildProtectScript,
  buildRevealScript,
  createPasswordSession,
  getNasPassword,
  normalizePasswordMode,
  withPasswordSession
} from './password.mjs';

test('normalizes the init password mode with prompt as the safe fallback', () => {
  assert.equal(normalizePasswordMode('temporary'), 'temporary');
  assert.equal(normalizePasswordMode('prompt'), 'prompt');
  assert.equal(normalizePasswordMode('anything-else'), 'prompt');
});

test('uses a user-bound encrypted temporary store and can reveal it', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('DPAPI verification runs on Windows');
    return;
  }

  assert.match(buildProtectScript('C:\\Temp\\nas-deploy-password.dpapi'), /ConvertFrom-SecureString/);
  assert.match(buildRevealScript('C:\\Temp\\nas-deploy-password.dpapi'), /SecureStringToBSTR/);

  const secret = `nas-test-${Date.now()}`;
  const session = createPasswordSession({ prompt: async () => secret });
  try {
    assert.equal(await session.get(), secret);
    assert.equal(await session.get(), secret);
    assert.ok(session.path);
    assert.ok(fs.existsSync(session.path));
  } finally {
    session.close();
  }
  assert.equal(fs.existsSync(session.path), false);
});

test('reuses one temporary password session across NAS commands', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('DPAPI verification runs on Windows');
    return;
  }

  let prompts = 0;
  const session = createPasswordSession({
    prompt: async () => {
      prompts += 1;
      return 'nas-session-test';
    }
  });
  const config = { nas: { passwordMode: 'temporary' } };
  const prompt = async () => { throw new Error('active session should provide the password'); };
  try {
    await withPasswordSession(session, async () => {
      assert.equal(await getNasPassword(null, config, { reason: 'first', prompt }), 'nas-session-test');
      assert.equal(await getNasPassword(null, config, { reason: 'second', prompt }), 'nas-session-test');
    });
  } finally {
    session.close();
  }
  assert.equal(prompts, 1);
});
