// 설정 파일, 외부 명령 실행, NAS 접속 등 공통 기능.
// 비밀번호는 어디에도 저장하지 않습니다. 실행하는 동안 메모리에만 두었다가 접속이 끝나면 사라집니다.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

export const CLI_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const TEMPLATE_DIR = path.join(CLI_DIR, '..', 'templates');
// 워크플로 파일만 GitHub 이 정한 위치에 있어야 하고, 나머지는 이 폴더 하나에 모입니다.
// 다른 위치를 쓰려면 NAS_DEPLOY_DIR 환경 변수로 바꿀 수 있습니다 (예: deploy).
export const BASE_DIR = (process.env.NAS_DEPLOY_DIR ?? 'infra/synology').replace(/[\/]+$/, '');
export const CONFIG_PATH = `${BASE_DIR}/deploy.config.json`;
export const ENV_PATH = `${BASE_DIR}/.env`;
export const WORKFLOW_PATH = '.github/workflows/deploy.yml';
export const COMPOSE_PATH = `${BASE_DIR}/compose.yaml`;
export const DEPLOY_SCRIPT_PATH = `${BASE_DIR}/deploy.sh`;
export const GATE_SCRIPT_PATH = `${BASE_DIR}/deploy-gate.sh`;
export const SECRET_NAMES = ['NAS_SSH_HOST', 'NAS_SSH_PORT', 'NAS_SSH_USER', 'NAS_SSH_PRIVATE_KEY', 'NAS_SSH_KNOWN_HOSTS'];
export const ZERO_TAG = '0'.repeat(40);
export const BAD_PASSWORD_MARK = 'NAS_DEPLOY_BAD_PASSWORD';
export const INSTALL_FAILED_MARK = 'NAS_DEPLOY_INSTALL_FAILED';

export class UserError extends Error {}

// ---------- 외부 명령 ----------
export function capture(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  return {
    code: result.status ?? 1,
    out: (result.stdout ?? '').replace(/\r/g, '').trim(),
    err: (result.error ? String(result.error.message) : result.stderr ?? '').replace(/\r/g, '').trim()
  };
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw new UserError(`${command} 명령을 실행하지 못했습니다: ${result.error.message}`);
  if (result.status !== 0) throw new UserError(`${command} 명령이 실패했습니다 (종료 코드 ${result.status}).`);
}

export const has = (command) => capture(process.platform === 'win32' ? 'where' : 'which', [command]).code === 0;

// ---------- 파일 ----------
export const expandHome = (target) => (target.startsWith('~') ? path.join(os.homedir(), target.slice(1)) : target);
export const shellQuote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;
export const readIfExists = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
export const writeFile = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

export function loadConfig({ required = true } = {}) {
  const raw = readIfExists(CONFIG_PATH);
  if (!raw) {
    if (!required) return null;
    throw new UserError(`설정 파일이 없습니다: ${CONFIG_PATH}\n  먼저 "nas-deploy init" 을 실행하세요. 저장소 폴더 안에서 실행해야 합니다.`);
  }
  return JSON.parse(raw);
}

export function saveConfig(config) {
  writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

export function ensureIgnored(pattern) {
  const current = readIfExists('.gitignore') ?? '';
  if (current.split(/\r?\n/).some((line) => line.trim() === pattern)) return false;
  fs.appendFileSync('.gitignore', `${current === '' || current.endsWith('\n') ? '' : '\n'}${pattern}\n`);
  return true;
}

// ---------- 설정값 도우미 ----------
export const imagePrefix = (config) => `ghcr.io/${config.owner}/${config.project}`;
export const nasDir = (config) => config.nas.dir ?? `/volume1/docker/${config.project}`;
export const keyPathOf = (config) => expandHome(config.keyPath);
export const adminKeyPath = (config) => expandHome(config.nas.adminKey ?? `~/.ssh/${config.project}_admin`);
export const knownHostsPath = (config) => path.join(path.dirname(keyPathOf(config)), `${config.project}_known_hosts`);
export const adminTarget = (config) => `${config.nas.adminUser}@${config.nas.host}`;
export const deployTarget = (config) => `${config.nas.deployUser}@${config.nas.host}`;
export const REMOTE_STAGE = '$HOME/.nas-deploy-upload';

// ---------- NAS 접속 ----------
// 접속 방식은 두 가지입니다.
//  - 관리자 열쇠가 등록되어 있으면 비밀번호 없이 접속합니다 (nas-deploy login).
//  - 없으면 SSH 비밀번호를 한 번 입력합니다. 입력값은 터미널이 직접 받고 도구는 보지 않습니다.
// 어느 쪽이든 NAS에서 관리자 권한이 필요한 작업은 sudo 비밀번호를 표준 입력으로 한 번만 전달합니다.
function sshArgs(config, extra = []) {
  const args = ['-p', String(config.nas.port), '-o', 'ConnectTimeout=20'];
  const key = config.nas.adminKey ? expandHome(config.nas.adminKey) : null;
  if (key && fs.existsSync(key)) args.push('-i', key, '-o', 'IdentitiesOnly=yes');
  return [...args, ...extra];
}

export const usesAdminKey = (config) => Boolean(config.nas.adminKey && fs.existsSync(expandHome(config.nas.adminKey)));

// NAS에서 스크립트를 실행합니다. password를 주면 스크립트 첫 줄의 sudo 확인에 쓰입니다.
export function remote(config, script, { password = null, interactive = false } = {}) {
  const body = password === null ? script : `sudo -S -p '' -v 2>/dev/null || { echo ${BAD_PASSWORD_MARK}; exit 9; }\n${script}`;
  const args = [...sshArgs(config, interactive ? ['-t'] : []), adminTarget(config), body];
  const result = spawnSync('ssh', args, {
    input: password === null ? undefined : `${password}\n`,
    encoding: 'utf8',
    stdio: [password === null ? 'inherit' : 'pipe', interactive ? 'inherit' : 'pipe', 'inherit']
  });
  if (result.error) throw new UserError(`NAS에 접속하지 못했습니다: ${result.error.message}`);
  const out = (result.stdout ?? '').replace(/\r/g, '');
  if (out.includes(BAD_PASSWORD_MARK)) throw new UserError('NAS 관리자 비밀번호가 맞지 않습니다. 다시 실행해 주세요.');
  if (out.includes(INSTALL_FAILED_MARK)) throw new UserError('NAS 설치 명령이 실패했습니다. NAS 관리자 권한과 설치 폴더를 확인해 주세요.');
  if (result.status !== 0 && !out) {
    throw new UserError(`NAS 접속이 실패했습니다 (종료 코드 ${result.status}). 주소와 포트, 계정을 확인해 주세요.`);
  }
  return { out, code: result.status ?? 1 };
}

// 파일을 같은 접속으로 함께 보냅니다. scp(SFTP)를 쓰지 않으므로 접속과 비밀번호 입력이 한 번으로 끝납니다.
export function filePayload(files) {
  const lines = [`rm -rf ${REMOTE_STAGE}`, `mkdir -p ${REMOTE_STAGE}`];
  for (const [name, content] of Object.entries(files)) {
    const packed = zlib.gzipSync(Buffer.from(content, 'utf8')).toString('base64');
    lines.push(`printf '%s' '${packed}' | base64 -d | gzip -d > ${REMOTE_STAGE}/${name}`);
  }
  return lines.join('\n');
}

// 배포용 열쇠로 접속해 봅니다. 비밀번호를 묻지 않으므로 점검에 씁니다.
export function deployKeyProbe(config, command) {
  const key = keyPathOf(config);
  if (!fs.existsSync(key)) return { code: 127, out: '', err: `열쇠 파일이 없습니다: ${key}` };
  return capture('ssh', [
    '-i', key,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-p', String(config.nas.port),
    '-o', 'ConnectTimeout=20',
    deployTarget(config),
    command
  ]);
}
