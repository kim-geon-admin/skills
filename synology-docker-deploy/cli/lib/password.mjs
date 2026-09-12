import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { UserError } from './core.mjs';

export const PASSWORD_MODES = ['prompt', 'temporary'];

export function normalizePasswordMode(value) {
  return value === 'temporary' ? 'temporary' : 'prompt';
}

const powershellQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;

export function buildProtectScript(file) {
  return [
    '$ErrorActionPreference = \'Stop\'',
    '$plain = [Console]::In.ReadToEnd()',
    '$secure = ConvertTo-SecureString -String $plain -AsPlainText -Force',
    `$secure | ConvertFrom-SecureString | Set-Content -LiteralPath ${powershellQuote(file)} -NoNewline`
  ].join('; ');
}

export function buildRevealScript(file) {
  return [
    '$ErrorActionPreference = \'Stop\'',
    `$secure = Get-Content -LiteralPath ${powershellQuote(file)} -Raw | ConvertTo-SecureString`,
    '$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)',
    'try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }'
  ].join('; ');
}

function runPowerShell(script, input = undefined) {
  const result = spawnSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script
  ], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) {
    throw new UserError('Windows 임시 비밀번호 보관 파일을 만들거나 읽지 못했습니다.');
  }
  return result.stdout ?? '';
}

export function createTemporaryPasswordStore(password) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-deploy-'));
  const file = path.join(directory, 'password.dpapi');
  try {
    if (process.platform !== 'win32') {
      throw new UserError('temporary 비밀번호 모드는 Windows PowerShell에서만 사용할 수 있습니다.');
    }
    runPowerShell(buildProtectScript(file), password);
    return file;
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    if (error instanceof UserError) throw error;
    throw new UserError('임시 비밀번호 보관 파일을 만들지 못했습니다.');
  }
}

export function revealTemporaryPassword(file) {
  if (process.platform !== 'win32') {
    throw new UserError('temporary 비밀번호 모드는 Windows PowerShell에서만 사용할 수 있습니다.');
  }
  return runPowerShell(buildRevealScript(file));
}

export function removeTemporaryPasswordStore(file) {
  if (!file) return;
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
}

export function createPasswordSession({ prompt }) {
  let file = null;
  let closed = false;
  return {
    get path() { return file; },
    async get() {
      if (closed) throw new UserError('비밀번호 세션이 이미 끝났습니다.');
      if (!file) file = createTemporaryPasswordStore(await prompt());
      return revealTemporaryPassword(file);
    },
    close() {
      if (closed) return;
      closed = true;
      removeTemporaryPasswordStore(file);
    }
  };
}

let activeSession = null;

export async function withPasswordSession(session, action) {
  const previous = activeSession;
  activeSession = session;
  const onInterrupt = () => {
    session.close();
    process.exitCode = 130;
  };
  process.once('SIGINT', onInterrupt);
  try {
    return await action();
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    session.close();
    activeSession = previous;
  }
}

export async function getNasPassword(rl, config, { reason, prompt }) {
  if (activeSession) return activeSession.get();
  if (normalizePasswordMode(config.nas?.passwordMode) === 'temporary') {
    const session = createPasswordSession({ prompt: () => prompt(rl, config, { reason }) });
    return withPasswordSession(session, () => session.get());
  }
  return prompt(rl, config, { reason });
}
