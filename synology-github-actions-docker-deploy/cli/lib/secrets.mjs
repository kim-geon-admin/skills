// secrets - GitHub 저장소에 NAS 접속 정보를 등록합니다.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { SECRET_NAMES, UserError, capture, keyPathOf, knownHostsPath, loadConfig } from './core.mjs';
import { ensureGitHubLogin, ensureWorkflowScope } from './github.mjs';
import { badItem, bold, confirm, cyan, detail, dim, heading, note, okItem, panel, skipItem, warnItem } from './ui.mjs';

export const githubRepo = (config) => `${config.owner}/${config.project}`;
export const secretSetArgs = (config, name) => ['secret', 'set', name, '--repo', githubRepo(config)];
export const secretListArgs = (config) => ['secret', 'list', '--repo', githubRepo(config)];
export const repoViewArgs = (config) => [
  'repo', 'view', githubRepo(config), '--json', 'nameWithOwner,visibility',
  '--jq', '.nameWithOwner + " (" + .visibility + ")"'
];

export function secretPreview(config) {
  return {
    NAS_SSH_HOST: config.nas.host,
    NAS_SSH_PORT: String(config.nas.port),
    NAS_SSH_USER: config.nas.deployUser,
    NAS_SSH_PRIVATE_KEY: keyPathOf(config),
    NAS_SSH_KNOWN_HOSTS: knownHostsPath(config)
  };
}

function setSecret(config, name, value) {
  const result = spawnSync('gh', secretSetArgs(config, name), { input: value, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  return { code: result.status ?? 1, err: (result.stderr ?? '').trim() };
}

export async function secretsCommand(rl) {
  const config = loadConfig();
  const state = await ensureGitHubLogin(rl);
  if (!state.installed) throw new UserError('gh(GitHub 명령줄 도구)를 설치한 뒤 다시 실행해 주세요.');
  if (!state.loggedIn) throw new UserError('GitHub 로그인이 필요합니다. 다시 실행하면 로그인 화면을 띄워 드립니다.');
  await ensureWorkflowScope(rl, state);

  const repo = capture('gh', repoViewArgs(config));
  const keyPath = keyPathOf(config);
  const hostsPath = knownHostsPath(config);

  panel('secrets - GitHub에 접속 정보 등록하기', [
    `저장소: ${repo.out || dim('확인 실패 - 저장소 폴더에서 실행했는지 확인하세요')}`,
    '',
    'GitHub Actions가 NAS에 접속할 때 쓰는 값 5개를 등록합니다.',
    '한 번 등록하면 화면에서 값을 다시 볼 수 없고, 배포할 때만 쓰입니다.',
    '',
    `${dim('레지스트리(이미지 저장소) 비밀번호는 필요 없습니다. GitHub이 자동으로 처리합니다.')}`
  ]);

  if (!fs.existsSync(keyPath)) throw new UserError(`배포 열쇠가 없습니다: ${keyPath}\n  먼저 "nas-deploy key" 를 실행하세요.`);
  if (!fs.existsSync(hostsPath)) throw new UserError(`NAS 신분증 파일이 없습니다: ${hostsPath}\n  먼저 "nas-deploy key" 를 실행하세요.`);

  const values = {
    NAS_SSH_HOST: config.nas.host,
    NAS_SSH_PORT: String(config.nas.port),
    NAS_SSH_USER: config.nas.deployUser,
    NAS_SSH_PRIVATE_KEY: fs.readFileSync(keyPath, 'utf8'),
    NAS_SSH_KNOWN_HOSTS: fs.readFileSync(hostsPath, 'utf8')
  };
  const preview = secretPreview(config);
  for (const name of SECRET_NAMES) {
    const shown = name.includes('KEY') ? dim(`파일: ${preview[name]}`)
      : name.includes('KNOWN') ? dim(`파일: ${preview[name]}`)
        : preview[name];
    detail(`${name} = ${shown}`);
  }
  if (!(await confirm(rl, '이 값들을 등록할까요?', true))) {
    skipItem('취소했습니다');
    return;
  }

  heading('등록');
  let failed = 0;
  for (const name of SECRET_NAMES) {
    const result = setSecret(config, name, values[name]);
    if (result.code === 0) okItem(`${name} 등록 완료`);
    else {
      failed += 1;
      badItem(`${name} 등록 실패`, result.err.split('\n')[0]);
    }
  }

  const list = capture('gh', secretListArgs(config));
  const registered = SECRET_NAMES.filter((name) => list.out.includes(name));
  if (registered.length === SECRET_NAMES.length) okItem('5개 모두 저장소에 등록되어 있습니다');
  else warnItem(`등록된 값이 ${registered.length}개입니다`, `빠진 값: ${SECRET_NAMES.filter((name) => !registered.includes(name)).join(', ')}`);

  panel('다음에 할 일', [
    `${bold('nas-deploy doctor')}  ${dim('배포 전 마지막 점검')}`,
    '',
    '점검이 끝나면 만든 파일을 커밋해서 올리세요. 그 순간 첫 배포가 시작됩니다.',
    `${dim('git add -A && git commit -m "Add NAS deployment" && git push')}`,
    '',
    `${cyan('※')} 배포가 성공하면 이 컴퓨터의 비밀 열쇠(${keyPath})는 지워도 됩니다.`
  ]);
  if (failed) throw new UserError('일부 값이 등록되지 않았습니다. 위 메시지를 확인해 주세요.');
}
